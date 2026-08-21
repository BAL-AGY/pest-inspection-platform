# Pest and service catalog

The conversion remains a qualified booked free inspection. The public funnel
does not quote treatment because every property must be inspected before an
accurate recommendation or price exists.

## Three deliberately separate values

1. **Qualification** answers whether the lead is complete, in the service
   area, supported, a homeowner, and ready enough to book. Server validation
   and scoring remain authoritative.
2. **Potential Value Range** is private acquisition context configured on the
   Company. It is neither a quote nor revenue and is shown only on the
   authenticated lead detail page.
3. **Actual contract value** is entered by staff after inspection/close. Only a
   won lead with an entered contract value produces `revenue_recorded` and
   contributes to revenue, CAC, ROAS, or ROI reporting.

## Default company configuration

| Category | Internal potential range | Funnel value |
|---|---:|---|
| General Pest | $200–$1,000 | `general_pest` |
| Fleas | $400–$1,000 | `fleas` |
| Rodents | $250–$5,000+ | `rodents` |
| Other | Unavailable | `other` |

The JSON in `Company.pestCategoryConfig` controls category labels, concern
mapping, and ranges per tenant. `Company.serviceArrangements` controls the
allowed `ONE_TIME`, `QUARTERLY`, and `BIMONTHLY` outcomes. Invalid/malformed
configuration fails back to the reviewed defaults rather than breaking the
funnel.

Legacy detailed pest answers remain accepted so an in-progress lead or older
record is not invalidated by deployment. New homeowners see only the four
operator categories. `Lead.pestConcern` preserves the submitted answer;
`Lead.pestCategory` stores its acquisition category. After the inspection,
staff may set `Lead.actualPestCategory` and `Lead.serviceArrangement` without
rewriting the original qualification history.

## Reporting

Dashboard category rows deduplicate server-authoritative `lead_created`,
`lead_qualified`, `inspection_booked`, `inspection_completed`, `customer_won`,
and `revenue_recorded` events inside the selected company-local date range.
Tenant and demo-mode filters are applied in the database query. Category
revenue and revenue per completed inspection use actual revenue events only.
Pre-inspection stages use the acquisition category; completed/customer/revenue
stages prefer the staff-confirmed actual category and fall back to acquisition
when the inspection category has not been recorded.

Category-level spend allocation, predicted lifetime value, margin, recurring
revenue schedules, and model-based lead prioritization are intentionally
deferred. Campaign spend does not currently identify a pest category, so
inventing category CAC/ROAS would be misleading. Overall CAC/ROAS/ROI and cost
per qualified booked inspection remain available from real spend and actual
won contract value.
