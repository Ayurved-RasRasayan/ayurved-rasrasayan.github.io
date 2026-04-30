import os
import time
import smtplib
import threading
import json
import traceback
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

import psycopg2
from dotenv import load_dotenv
from flask import Flask

# ─── CONFIGURATION ─────────────────────────────────────────────────────────────
load_dotenv()

app = Flask(__name__)

DB_URL     = os.environ.get("DATABASE_URL")
EMAIL_USER = os.environ.get("EMAIL_USER")
EMAIL_PASS = os.environ.get("EMAIL_PASS")

# ─── DATABASE CONNECTION ───────────────────────────────────────────────────────
def get_db_connection():
    url = DB_URL
    if "sslmode=" not in url:
        url += "?sslmode=require"
    return psycopg2.connect(url)

# ─── EMAIL HTML TEMPLATE ───────────────────────────────────────────────────────
def build_email_html(order, status):
    status_colors = {
        'Pending':   {'bg': '#fff7ed', 'text': '#b45309', 'border': '#fcd34d'},
        'Shipping':  {'bg': '#eff6ff', 'text': '#1e40af', 'border': '#bfdbfe'},
        'Completed': {'bg': '#f0fdf4', 'text': '#15803d', 'border': '#86efac'},
        'Success':   {'bg': '#dcfce7', 'text': '#15803d', 'border': '#86efac'},
        'Rejected':  {'bg': '#fee2e2', 'text': '#991b1b', 'border': '#fca5a5'}
    }
    color = status_colors.get(status, {'bg': '#f3f4f6', 'text': '#374151', 'border': '#d1d5db'})

    items_html = "<ul>"
    try:
        items = json.loads(order['items']) if isinstance(order['items'], str) else order['items']
        for item in items:
            items_html += f"<li>{item.get('name', 'Product')} (x{item.get('quantity', 1)})</li>"
    except:
        items_html += "<li>Order items</li>"
    items_html += "</ul>"

    return f"""
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;">
      <div style="background: #2d4a22; padding: 28px 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px;">🌿 NaturaBotanica</h1>
        <p style="color: #a3b14b; margin: 6px 0 0; font-size: 14px;">Order Status Update</p>
      </div>
      <div style="padding: 32px;">
        <p style="color: #374151; font-size: 16px;">Hello <strong>{order['client_name']}</strong>,</p>
        <p style="color: #6b7280;">Your order status has been updated.</p>

        <div style="background: {color['bg']}; border: 1px solid {color['border']}; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
          <span style="color: {color['text']}; font-size: 20px; font-weight: 700;">{status}</span>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr><td style="padding:8px; color:#6b7280;">Order ID</td><td style="padding:8px; text-align:right; font-weight:bold;">#{order['id']}</td></tr>
          <tr><td style="padding:8px; color:#6b7280;">Total (USD)</td><td style="padding:8px; text-align:right; font-weight:bold;">${order['total_usd']}</td></tr>
          <tr><td style="padding:8px; color:#6b7280;">Total (NPR)</td><td style="padding:8px; text-align:right; font-weight:bold;">Rs. {order['total_npr']}</td></tr>
        </table>

        {items_html}

        <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">
          © {datetime.now().year} NaturaBotanica. All rights reserved.
        </p>
      </div>
    </div>
    """

# ─── EMAIL SENDER ──────────────────────────────────────────────────────────────
def send_email(to_email, subject, html_body):
    try:
        msg = MIMEMultipart()
        msg['From']    = f"NaturaBotanica <{EMAIL_USER}>"
        msg['To']      = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(html_body, 'html'))

        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(EMAIL_USER, EMAIL_PASS)
            server.send_message(msg)

        print(f"📧 Email sent to {to_email}")
        return True
    except Exception as e:
        print(f"❌ Email failed to {to_email}: {e}")
        return False

# ─── BACKGROUND WORKER ─────────────────────────────────────────────────────────
def check_orders_and_send_emails():
    print("🚀 Email Worker Started...")
    print(f"🔍 DB_URL     = {DB_URL}")
    print(f"🔍 EMAIL_USER = {EMAIL_USER}")
    print(f"🔍 EMAIL_PASS = {'set ✅' if EMAIL_PASS else 'NOT SET ❌'}")

    while True:
        conn = None
        try:
            print("🔌 Attempting DB connection...")
            conn = get_db_connection()
            print("✅ DB connected!")

            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, client_email, client_name, status, total_usd, total_npr, items
                FROM orders
                WHERE email_sent = FALSE
                  AND status != 'Pending'
                  AND client_email IS NOT NULL
                  AND client_email != ''
                  AND client_email != 'N/A'
                LIMIT 10
            """)
            orders = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            if not orders:
                print("✅ No pending emails.")
            else:
                print(f"📝 Found {len(orders)} order(s) to email.")

                for row in orders:
                    order = dict(zip(col_names, row))
                    print(f"  → Order #{order['id']} ({order['status']}) → {order['client_email']}")

                    html_content = build_email_html(order, order['status'])
                    success = send_email(
                        order['client_email'],
                        f"NaturaBotanica — Order #{order['id']} is now {order['status']}",
                        html_content
                    )

                    if success:
                        cursor.execute(
                            "UPDATE orders SET email_sent = TRUE WHERE id = %s",
                            (order['id'],)
                        )
                        conn.commit()
                        print(f"  ✔ DB updated for order #{order['id']}")
                    else:
                        print(f"  ⚠ Email failed — DB not updated for order #{order['id']}")

        except Exception as e:
            print(f"❌ Worker Error: {e}")
            traceback.print_exc()
        finally:
            if conn:
                try:
                    conn.close()
                except:
                    pass

        print("😴 Sleeping 10s...")
        time.sleep(10)

# ─── FLASK HEALTH CHECK ────────────────────────────────────────────────────────
@app.route('/')
def home():
    return "🐍 NaturaBotanica Email Worker is Running"

# ─── START BACKGROUND THREAD ───────────────────────────────────────────────────
_debug_mode = os.environ.get("FLASK_DEBUG", "0").lower() in ("1", "true")

if not _debug_mode:
    print("🔧 Starting background email worker thread...")
    worker_thread = threading.Thread(target=check_orders_and_send_emails, daemon=True)
    worker_thread.start()
else:
    print("⚠️  FLASK_DEBUG is active — worker NOT started.")

# ─── LOCAL RUNNER ──────────────────────────────────────────────────────────────
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, use_reloader=False)
