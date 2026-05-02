import os
import requests
import time
import smtplib
import threading
import json
import traceback
import socket
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

import psycopg2
from dotenv import load_dotenv
from flask import Flask, request, jsonify

# ─── CONFIGURATION ─────────────────────────────────────
load_dotenv()

app = Flask(__name__)

DB_URL            = os.environ.get("DATABASE_URL")
EMAIL_USER        = os.environ.get("EMAIL_USER")
EMAIL_PASS        = os.environ.get("EMAIL_PASS")
INVENTORY_API_URL = os.environ.get("INVENTORY_API_URL")
API_SECRET        = os.environ.get("API_SECRET", "change_me_to_something_secure")

# ─── DATABASE CONNECTION ─────────────────────────────────
def get_db_connection():
    try:
        print("📍 Attempting DB connection...")
        conn = psycopg2.connect(DB_URL, sslmode='allow', connect_timeout=5)
        print("✅ DB connected successfully")
        return conn
    except Exception as e:
        print(f"❌ DB connection failed: {e}")
        raise

# ─── EMAIL HTML TEMPLATE ─────────────────────────────────
def build_email_html(order, status):
    status_colors = {
        'Pending':   {'bg': '#fff7ed', 'text': '#b45309', 'border': '#fcd34d'},
        'Shipping':  {'bg': '#eff6ff', 'text': '#1e40af', 'border': '#bfdbfe'},
        'Completed': {'bg': '#f0fdf4', 'text': '#15803d', 'border': '#86efac'},
        'Success':   {'bg': '#dcfce7', 'text': '#15803d', 'border': '#86efac'},
        'Rejected':  {'bg': '#fee2e2', 'text': '#991b1b', 'border': '#fca5a5'},
    }
    color = status_colors.get(status, {'bg': '#f3f4f6', 'text': '#374151', 'border': '#d1d5db'})

    # FIX (Bug 4): Build proper <tr><td> rows for the table body, not <li> elements
    rows_html = ""
    try:
        items = json.loads(order['items']) if isinstance(order['items'], str) else order['items']
        for item in items:
            name     = item.get('name', 'Product')
            qty      = item.get('quantity', 1)
            price    = item.get('price', 0)
            subtotal = round(qty * price, 2)
            rows_html += f"""
            <tr>
              <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb;">{name}</td>
              <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb;">{qty}</td>
              <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb;">${price}</td>
              <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb;">${subtotal}</td>
            </tr>"""
    except Exception:
        rows_html = """
        <tr>
          <td colspan="4" style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb;">
            Order items unavailable
          </td>
        </tr>"""

    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;
                background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;">
      <div style="background: #2d4a22; padding: 28px 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px;">🌿 NaturaBotanica</h1>
        <p style="color: #a3b14b; margin: 6px 0 0; font-size: 14px;">Order Status Update</p>
      </div>

      <div style="padding: 32px;">
        <p style="color: #374151; font-size: 16px;">Hello <strong>{order['client_name']}</strong>,</p>
        <p style="color: #6b7280; font-size: 14px;">Your order status has been updated.</p>

        <div style="background: {color['bg']}; border: 1px solid {color['border']};
                    border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
          <span style="color: {color['text']}; font-size: 20px; font-weight: 700;">{status}</span>
        </div>

        <h3 style="border-bottom: 1px solid #e5e7eb; padding-bottom: 10px;
                   margin-bottom: 15px; color: #1f2937;">Order Details</h3>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;
                      border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background-color: #f9fafb; text-align: left;">
              <th style="padding: 12px; border-bottom: 1px solid #e5e7eb;">Product</th>
              <th style="padding: 12px; border-bottom: 1px solid #e5e7eb;">Qty</th>
              <th style="padding: 12px; border-bottom: 1px solid #e5e7eb;">Price</th>
              <th style="padding: 12px; border-bottom: 1px solid #e5e7eb;">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows_html}
          </tbody>
          <tfoot>
            <tr style="background-color: #f9fafb; font-weight: bold;
                       border-top: 2px solid #e5e7eb;">
              <td style="padding: 12px; color: #374151;">Total Amount</td>
              <td colspan="3" style="padding: 12px; text-align: right; color: #a3b14b;">
                ${order['total_usd']} (NPR {order['total_npr']})
              </td>
            </tr>
          </tfoot>
        </table>

        <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">
          &copy; {datetime.now().year} NaturaBotanica. All rights reserved.
        </p>
      </div>
    </div>
    """

# ─── HELPER: CHECK INVENTORY API ─────────────────────────
def check_inventory_api():
    """
    Checks if the external Inventory API is accessible.
    Returns True if healthy, False otherwise.
    """
    if not INVENTORY_API_URL:
        print("⚠️ INVENTORY_API_URL is not configured — skipping check.")
        return False
    try:
        print(f"🔍 Pinging Inventory API: {INVENTORY_API_URL}")
        response = requests.get(INVENTORY_API_URL, timeout=5)
        if response.status_code == 200:
            print(f"✅ Inventory API healthy. Response: {response.text}")
            return True
        else:
            print(f"⚠️ Inventory API returned HTTP {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"❌ Inventory API connection error: {e}")
        return False

# ─── EMAIL SENDER (FORCE IPv4) ────────────────────────────
# FIX (Bug 3): smtplib.SMTP() does not accept a raw socket as its first argument.
# Instead, we subclass SMTP and override _get_socket to force IPv4.
class IPv4SMTP(smtplib.SMTP):
    """SMTP subclass that forces IPv4 by resolving the host to an IPv4 address
    before connecting, avoiding issues on cloud providers where IPv6 may fail."""
    def _get_socket(self, host, port, timeout):
        ai = socket.getaddrinfo(host, port, socket.AF_INET)[0]
        ipv4_host = ai[4][0]
        print(f"📍 Resolved {host} → {ipv4_host} (IPv4), connecting on port {port}...")
        sock = socket.socket(ai[0], ai[1], ai[2])
        sock.settimeout(timeout)
        sock.connect(ai[4])
        return sock

def send_email(to_email, subject, html_body):
    try:
        msg = MIMEMultipart()
        msg['From']    = f"NaturaBotanica <{EMAIL_USER}>"
        msg['To']      = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(html_body, 'html'))

        smtp_host = "smtp-relay.brevo.com"
        smtp_port = 587

        with IPv4SMTP(smtp_host, smtp_port) as server:
            print("📍 Starting TLS...")
            server.starttls()
            print(f"📍 Logging in as {EMAIL_USER}...")
            server.login(EMAIL_USER, EMAIL_PASS)
            server.send_message(msg)

        print(f"✅ Email sent to {to_email}")
        return True
    except Exception as e:
        print(f"❌ Email failed to {to_email}: {e}")
        traceback.print_exc()
        return False

# ─── ROUTE 1: WEBHOOK (INSTANT EMAIL TRIGGER) ────────────
@app.route('/send-email', methods=['POST'])
def trigger_instant_email():
    # 1. Security check
    secret = request.headers.get('X-API-SECRET')
    if secret != API_SECRET:
        return jsonify({"success": False, "message": "Unauthorized"}), 403

    # 2. Get order ID
    data = request.json
    order_id = data.get('id')
    if not order_id:
        return jsonify({"success": False, "message": "Missing order ID"}), 400

    conn = None
    try:
        print(f"🔔 [WEBHOOK] Triggered for Order #{order_id}")
        conn = get_db_connection()
        cursor = conn.cursor()

        # 3. Fetch order details
        cursor.execute("""
            SELECT id, client_email, client_name, status, total_usd, total_npr, items
            FROM orders WHERE id = %s
        """, (order_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"success": False, "message": "Order not found"}), 404

        col_names = [desc[0] for desc in cursor.description]
        order = dict(zip(col_names, row))

        # 4. Inventory check (advisory only — logs a warning but does not block the email)
        # FIX (Bug 6): Documented clearly that this check is informational, not a gate.
        # If you want to block on inventory failure, return a 503 here instead.
        is_inventory_healthy = check_inventory_api()
        if not is_inventory_healthy:
            print("⚠️ [WEBHOOK] Inventory API is down — proceeding with order data as-is.")

        # 5. Build and send email
        html_content = build_email_html(order, order['status'])
        success = send_email(
            order['client_email'],
            f"NaturaBotanica — Order #{order['id']} is now {order['status']}",
            html_content
        )

        if success:
            cursor.execute("UPDATE orders SET email_sent = TRUE WHERE id = %s", (order_id,))
            conn.commit()
            print(f"✅ [WEBHOOK] DB updated for Order #{order_id}")
            return jsonify({"success": True, "message": "Email sent"})
        else:
            return jsonify({"success": False, "message": "SMTP error"}), 500

    except Exception as e:
        print(f"❌ [WEBHOOK] Critical error: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        if conn:
            conn.close()

# ─── ROUTE 2: INVENTORY HEALTH CHECK ─────────────────────
@app.route('/check-inventory', methods=['GET'])
def check_inventory_status():
    status = check_inventory_api()
    if status:
        return jsonify({"inventory_api": "online",  "message": "Inventory API is reachable"}), 200
    else:
        return jsonify({"inventory_api": "offline", "message": "Inventory API is unreachable"}), 503

# ─── BACKGROUND WORKER (FALLBACK EMAIL SENDER) ───────────
def check_orders_and_send_emails():
    print("🚀 Background worker started...")

    while True:
        conn = None
        try:
            conn = get_db_connection()
            cursor = conn.cursor()

            # FIX (Bug 1): Changed NOT LIKE to LIKE so valid emails are included.
            # FIX (Bug 2): Consolidated status filter into SQL so Rejected orders
            #              are never fetched and won't loop forever.
            # FIX (Cleanup): Removed the duplicate IS NOT NULL clause.
            cursor.execute("""
                SELECT id, client_email, client_name, status, total_usd, total_npr, items
                FROM orders
                WHERE email_sent = FALSE
                  AND status IN ('Shipping', 'Completed', 'Success')
                  AND client_email IS NOT NULL
                  AND client_email != ''
                  AND client_email != 'N/A'
                  AND client_email LIKE '%@%'
                LIMIT 10
            """)
            orders = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            if orders:
                print(f"🔙 [WORKER] Found {len(orders)} order(s) requiring emails.")
                for row in orders:
                    order = dict(zip(col_names, row))
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
                        print(f"✔ [WORKER] DB updated for Order #{order['id']}")
                    else:
                        print(f"⚠ [WORKER] SMTP error for Order #{order['id']}")
            else:
                print("😴 [WORKER] No pending orders. Sleeping...")

        except Exception as e:
            print(f"❌ [WORKER] Error: {e}")
            traceback.print_exc()
        finally:
            if conn:
                conn.close()

        time.sleep(10)

# ─── ROUTE 3: HOME / HEALTH CHECK ────────────────────────
@app.route('/')
def home():
    return "🐍 NaturaBotanica backend is running."

# ─── STARTUP ─────────────────────────────────────────────
if __name__ == '__main__':
    debug_mode = os.environ.get("FLASK_DEBUG", "0").lower() in ("1", "true")

    if not debug_mode:
        print("🔧 Starting background worker thread...")
        worker_thread = threading.Thread(target=check_orders_and_send_emails, daemon=True)
        worker_thread.start()

    app.run(host='0.0.0.0', port=10000, use_reloader=False)
