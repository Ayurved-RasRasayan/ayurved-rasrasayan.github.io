import os
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

# ─── CONFIGURATION ─────────────────────────────────────────────
load_dotenv()

app = Flask(__name__)

# Database Connection (PostgreSQL)
# Ensure you have a DATABASE_URL environment variable set
# Example: postgresql://user:password@host:port/database
DB_URL = os.environ.get("DATABASE_URL")

# SMTP / Email Configuration
EMAIL_USER = os.environ.get("EMAIL_USER")
EMAIL_PASS = os.environ.get("EMAIL_PASS") # <--- REPLACE THIS WITH YOUR BREVO PASSWORD
# Note: For Brevo, use port 587 and smtp-relay.brevo.com

# API Secret for Security (Use a random string in your .env)
API_SECRET = os.environ.get("API_SECRET", "change_me_to_something_secure")

# ─── DATABASE CONNECTION (ROBUST FIX) ────────────────────────────────
def get_db_connection():
    try:
        print("📍 Attempting DB Connection...")
        conn = psycopg2.connect(
            DB_URL,
            sslmode='allow', # Useful for connections to cloud DBs
            connect_timeout=5 # 5 seconds to connect
        )
        print("✅ DB Connected Successfully")
        return conn
    except Exception as e:
        print(f"❌ DB Connection Failed: {e}")
        raise e

# ─── EMAIL HTML TEMPLATE ───────────────────────────────────────────────
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
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;">
      <div style="background: #2d4a22; padding: 28px 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px;">🌿 NaturaBotanica</h1>
        <p style="color: #a3b14b; margin: 6px 0 0; font-size: 14px;">Order Status Update</p>
      </div>
      
      <div style="padding: 32px;">
        <p style="color: #374151; font-size: 16px;">Hello <strong>{order['client_name']}</strong>,</p>
        <p style="color: #6b7280; font-size: 14px;">Your order status has been updated.</p>

        <div style="background: {color['bg']}; border: 1px solid {color['border']}; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
          <span style="color: {color['text']}; font-size: 20px; font-weight: 700;">{status}</span>
        </div>

        <h3 style="border-bottom: 1px solid #e5e7eb; padding-bottom: 10px; margin-bottom: 15px; color: #1f2937;">Order Details</h3>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background-color: #f9fafb; text-align: left;">
              <th style="padding: 12px; border-bottom: 1px solid #e5e7eb;">Product</th>
              <th style="padding: 12px; border-bottom: 1px solid #e5e7eb;">Qty</th>
              <th style="padding: 12px; border-bottom: 1px solid #e5e7eb;">Price</th>
              <th style="padding: 12px; border-bottom: 1px solid #e5e7eb;">Total</th>
            </tr>
          </thead>
          <tbody>
            {items_html}
          </tbody>
          <tfoot>
            <tr style="background-color: #f9fafb; font-weight: bold; border-top: 2px solid #e5e7eb;">
              <td style="padding: 12px; color: #374151;">Total Amount</td>
              <td colspan="2" style="padding: 12px; text-align: right; color: #a3b14b;">
                $ {order['total_usd']} (NPR {order['total_npr']})
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

# ─── EMAIL SENDER (FORCE IPv4 FIX) ────────────────────────────────────
def send_email(to_email, subject, html_body):
    try:
        msg = MIMEMultipart()
        msg['From']    = f"NaturaBotanica <{EMAIL_USER}>"
        msg['To']      = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(html_body, 'html'))

        print(f"📍 Resolving Gmail/Brevo IPv4 Address...")
        
        # FORCE IPv4 CONNECTION FIX
        # smtplib often defaults to IPv6 which might fail on some cloud providers.
        # We use socket.getaddrinfo to get the IPv4 address explicitly.
        smtp_host = "smtp-relay.brevo.com"
        smtp_port = 587
        
        # Get IPv4 address info (AF_INET is IPv4)
        # [0] takes the first result. This returns (family, type, proto, canonname, sockaddr)
        ai = socket.getaddrinfo(smtp_host, smtp_port, socket.AF_INET)[0]
        
        # Create a raw socket using the IPv4 address (ai[4])
        raw_socket = socket.socket(ai[0], ai[1], ai[2])
        
        print(f"📍 Connecting to {ai[4][0]} (IPv4) on port {smtp_port}...")
        
        # Pass the connected socket to smtplib
        with smtplib.SMTP(raw_socket) as server:
            print(f"📍 Socket Connected. Initializing TLS...")
            server.starttls() # Secure the connection
            print(f"📍 Logging in as {EMAIL_USER}...")
            server.login(EMAIL_USER, EMAIL_PASS)
            print(f"📧 Sending email...")
            server.send_message(msg)

        print(f"✅ Email sent to {to_email}")
        return True
    except Exception as e:
        print(f"❌ Email failed to {to_email}: {e}")
        return False

# ─── ROUTE 1: WEBHOOK (INSTANT EMAIL TRIGGER) ───────────────────────────────
@app.route('/send-email', methods=['POST'])
def trigger_instant_email():
    # 1. Security Check
    secret = request.headers.get('X-API-SECRET')
    if secret != API_SECRET:
        return jsonify({"success": False, "message": "Unauthorized"}), 403

    # 2. Get Order ID
    data = request.json
    order_id = data.get('id')

    if not order_id:
        return jsonify({"success": False, "message": "Missing order ID"}), 400

    conn = None
    try:
        print(f"🔔 [WEBHOOK] Trigger for Order #{order_id}")
        
        conn = get_db_connection()
        cursor = conn.cursor()

        # 3. Fetch Order Details
        cursor.execute("""
            SELECT id, client_email, client_name, status, total_usd, total_npr, items
            FROM orders WHERE id = %s
        """, (order_id,))
        
        row = cursor.fetchone()
        if not row:
            return jsonify({"success": False, "message": "Order not found"}), 404

        # Convert row to dict with keys (handles psycopg2 NamedTuple)
        col_names = [desc[0] for desc in cursor.description]
        order = dict(zip(col_names, row))

        html_content = build_email_html(order, order['status'])
        success = send_email(
            order['client_email'],
            f"NaturaBotanica — Order #{order['id']} is now {order['status']}",
            html_content
        )

        if success:
            cursor.execute("UPDATE orders SET email_sent = TRUE WHERE id = %s", (order_id,))
            conn.commit()
            print(f"✅ [WEBHOOK] DB Updated for Order #{order_id}")
            return jsonify({"success": True, "message": "Email sent"})
        else:
            return jsonify({"success": False, "message": "SMTP error"}), 500

    except Exception as e:
        print(f"❌ [WEBHOOK] Critical Error: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        if conn: conn.close()

# ─── ROUTE 2: BACKGROUND WORKER (FALLBACK) ───────────────────────────────────
def check_orders_and_send_emails():
    print("🚀 Background Worker Started...")
    
    while True:
        conn = None
        try:
            # Find orders that:
            # 1. Email not yet sent
            # 2. Status is NOT 'Pending' (e.g., status changed to 'Shipping' via admin dashboard)
            conn = get_db_connection()
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

            if orders:
                print(f"🔙 [WORKER] Found {len(orders)} orders requiring updates.")
                for row in orders:
                    order = dict(zip(col_names, row))
                    
                    # Only send if status changed to something meaningful (Shipping/Completed)
                    if order['status'] in ['Shipping', 'Completed', 'Success']:
                        html_content = build_email_html(order, order['status'])
                        success = send_email(
                            order['client_email'],
                            f"NaturaBotanica — Order #{order['id']} is now {order['status']}",
                            html_content
                        )

                        if success:
                            cursor.execute("UPDATE orders SET email_sent = TRUE WHERE id = %s", (order['id'],))
                            conn.commit()
                            print(f"  ✔ [WORKER] DB updated for Order #{order['id']}")
                        else:
                            print(f"  ⚠ [WORKER] SMTP error for Order #{order['id']}")

            conn.close()

        except Exception as e:
            print(f"❌ [WORKER] Error: {e}")
            traceback.print_exc()
            if conn: conn.close()

        print("😴 Sleeping for 10 seconds...")
        time.sleep(10)

# ─── ROUTE 3: HEALTH CHECK ───────────────────────────────────────────
@app.route('/')
def home():
    return "🐍 NaturaBotanica Email Worker is Running"

# ─── STARTUP ───────────────────────────────────────────────────────────
if __name__ == '__main__':
    # Check if running in debug mode or production
    debug_mode = os.environ.get("FLASK_DEBUG", "0").lower() in ("1", "true")

    if not debug_mode:
        print("🔧 Starting background worker thread...")
        # Start the background worker in a separate daemon thread
        worker_thread = threading.Thread(target=check_orders_and_send_emails, daemon=True)
        worker_thread.start()
    
    # Run Flask App
    # Use host='0.0.0.0' to make it accessible externally (Render requires 0.0.0.0)
    # Use port=10000 for HTTP, but your SMTP is on 587.
    app.run(host='0.0.0.0', port=10000, use_reloader=False)
