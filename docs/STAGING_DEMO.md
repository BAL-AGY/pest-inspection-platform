# Staging client demo

Everything in this walkthrough is synthetic. Confirm the global `STAGING DEMO`
banner and owner `DEMO DATA` badge before entering the sample records.

## Homeowner journey

Open this placeholder-based URL using the actual Render staging hostname:

```text
https://STAGING_HOST/?utm_source=google&utm_medium=cpc&utm_campaign=termite-inspection&utm_content=client-demo-search&utm_term=termite-help
```

1. Click **Get My Free Inspection**.
2. ZIP code: `78701`.
3. Own this home: **Yes**.
4. Pest issue: **Termites**.
5. Problem: **It's a serious infestation**.
6. Existing pest-control provider: **Yes**.
7. Switch reason: **Pests keep coming back after their treatment**.
8. Timeline: **As soon as possible**.
9. First name: `Avery`; last name: `Demo`.
10. Email: `avery.demo@example.invalid`.
11. Phone: `5125550199`.
12. Select appointment email and SMS consent to demonstrate simulated
    confirmation logging. Marketing consent may remain unchecked.
13. Click **See Available Times**, choose an available slot, and click
    **Book Free Inspection**.
14. Confirm the page shows the booked date/time. No real email or SMS is sent;
    the deterministic adapter records provider acceptance for demo purposes.

Use a fresh private browser session or a unique contact suffix for repeated
demos so the anonymous visitor/lead journey is easy to identify.

## Owner journey

1. Open `/login` and use the staging owner email/password supplied privately
   during provisioning (never place it in this document or a client screen).
2. The header must show **STAGING**, **DEMO DATA**, and **MESSAGES SIMULATED**.
3. On **Overview**, choose **Last 30 days** and explain the top sequence:
   spend → leads → qualified → booked → customers → attributed revenue.
4. Open **Leads** and find `Avery Demo` in **Inspection Booked**.
5. Open the lead and review the validated qualification answers, score/SQL
   classification, first/last attribution (`google / cpc`, campaign
   `termite-inspection`), appointment, and timeline.
6. Open **Calendar** and confirm the same inspection appears on the correct
   company-local day.
7. On the lead, mark the appointment **completed**.
8. Enter contract value `1500.00` and click **Mark Won**.
9. Open **Marketing**, add a real-to-the-demo spend row: source `google`,
   medium `cpc`, campaign `termite-inspection`, amount `500.00`, with a period
   covering today. This is explicitly demo input, not claimed performance.
10. Return to **Overview → Last 30 days**. Show cost per booked inspection,
    CAC, attributed revenue, ROAS, funnel conversion, and the Google campaign
    row. Explain that unavailable metrics remain labeled unavailable rather
    than invented as zero.

The deterministic seed also supplies examples across qualified, booked,
completed, won, and lost states so the dashboard is credible before the live
walkthrough. `npm run db:staging:reseed` returns those synthetic fixtures to a
known baseline when the explicit staging guard is present.
