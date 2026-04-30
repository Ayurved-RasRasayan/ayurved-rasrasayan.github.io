import os
import time
import smtplib
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

import psycopg2
from dotenv import load_dotenv
from flask import Flask

# Load environment variables
load_dotenv()

app = Flask(__name__)

# ─── CONFIGURATION ─────────────────────────────────────────────────────────────
DB_URL = os.environ.get('DATABASE_URL')
EMAIL_USER = os.environ.get('EMAIL_USER')
EMAIL_PASS = os.environ.get('EMAIL_PASS')

# ─── EMAIL HTML TEMPLATE ───────────────────────────────────────────────────────
def build_email_html(order, status):
    # Color mapping matching the original Node design
    status_colors = {
        'Pending':   {'bg': '#fff7ed', 'text': '#b45309', 'border': '#fcd34d'},
        'Shipping':  {'bg': '#eff6ff', 'text': '#1e40af', 'border': '#bfdbfe'},
        'Completed': {'bg': '#f0fdf4', 'text': '#15803d', 'border': '#86efac'},
        'Success':   {'bg': '#dcfce7', 'text': '#15803d', 'border': '#86efac'},
        'Rejected':  {'bg': '#fee2e2', 'text': '#991b1b', 'border': '#fca5a5'}
    }
    color = status_colors.get(status, {'bg': '#f3f4f6', 'text': '#374151', 'border': '#d1d5db'})

    # Parse items safely
    items_html = "<ul>"
    try:
        # If items is stored as string, parse it, otherwise assume dict/list
        import json
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

# ─── DATABASE & EMAIL WORKER ───────────────────────────────────────────────────
def send_email(to_email, subject, html_body):
    try:
        msg = MIMEMultipart()
        msg['From'] = f"NaturaBotanica <{EMAIL_USER}>"
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(html_body, 'html'))

        with smtplib.SMTP('smtp.gmail.com', 587) as server:
            server.starttls()
            server.login(EMAIL_USER, EMAIL_PASS)
            server.send_message(msg)
        print(f"📧 Email sent to {to_email}")
        return True
    except Exception as e:
        print(f"❌ Email failed to {to_email}: {e}")
        return False

def check_orders_and_send_emails():
    print("🚀 Python Email Worker Started...")
    while True:
        conn = None
        try:
            # Connect to DB
            conn = psycopg2.connect(DB_URL, sslmode='require')
            cursor = conn.cursor()

            # 1. Find orders where email_sent is FALSE and status is NOT Pending
            # (We usually don't email on 'Pending', only on status changes like Shipping/Completed)
            query = """
                SELECT id, client_email, client_name, status, total_usd, total_npr, items 
                FROM orders 
                WHERE email_sent = FALSE AND status != 'Pending' AND client_email IS NOT NULL
                LIMIT 5;
            """
            cursor.execute(query)
            orders = cursor.fetchall()

            if orders:
                print(f"📝 Found {len(orders)} orders requiring emails.")
                
                # Get column names from cursor description to map to dict
                col_names = [desc[0] for desc in cursor.description]

                for row in orders:
                    order = dict(zip(col_names, row))
                    
                    # Send Email
                    html_content = build_email_html(order, order['status'])
                    success = send_email(
                        order['client_email'],
                        f"Order #{order['id']} Status: {order['status']}",
                        html_content
                    )

                    # 2. Update DB to prevent re-sending
                    if success:
                        update_query = "UPDATE orders SET email_sent = TRUE WHERE id = %s"
                        cursor.execute(update_query, (order['id'],))
                        conn.commit()

        except Exception as e:
            print(f"❌ Worker Error: {e}")
        finally:
            if conn: conn.close()

        # Sleep for 10 seconds before checking again
        time.sleep(10)

# ─── FLASK ROUTES (For Health Check) ────────────────────────────────────────────
@app.route('/')
def home():
    return "🐍 Python Email Worker is Running"

# Start worker in background thread
if __name__ == '__main__':
    # Start the email loop in a separate thread so Flask can run simultaneously
    worker_thread = threading.Thread(target=check_orders_and_send_emails)
    worker_thread.daemon = True
    worker_thread.start()

    # Run Flask (Default port 5000)
    app.run(host='0.0.0.0', port=5000, use_reloader=False)
