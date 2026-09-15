# Owner booking SMS

New bookings schedule an owner SMS after the booking transaction commits. The
message contains the customer name, appointment time in the company timezone,
and an authenticated dashboard link. Demo appointments are excluded.

Configure these server environment variables on the deployed application:

- `OWNER_BOOKING_SMS_ENABLED=true`
- `OWNER_BOOKING_SMS_COMPANY_SLUG`: exact company slug to receive alerts for
- `OWNER_BOOKING_SMS_TO`: the owner's opted-in phone number, including `+` and country code
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`: account credentials and SMS-capable sender
- `AUTH_URL`: dashboard HTTPS origin

Keep credentials in the hosting environment's secret settings, never in git.
Redeploy/restart after configuration. The general customer communication provider
is independent of this setting. Set `OWNER_BOOKING_SMS_ENABLED=false` to disable.

The adapter uses the [Twilio Messages API](https://www.twilio.com/docs/messaging/api/message-resource).
Trial accounts require verifying the recipient in Twilio first.

## Verification and operations

Book a new, non-demo inspection for the configured company and check the owner's
phone. In the lead's communication history, `owner_booking_alert` records the
attempt. `accepted` means Twilio accepted it, not confirmed handset delivery.
Check Twilio's message logs for delivery details.

The shared communication gate checks suppression of the owner's number and
creates a unique attempt per appointment before sending. Customer consent is
not used for the owner's alert. Duplicate calls do not resend, including after
an ambiguous timeout. Failed sends require operator investigation; there is no
automatic retry or durable background queue. A process crash before the callback
runs can lose an alert. SMS failures never roll back the booking.
