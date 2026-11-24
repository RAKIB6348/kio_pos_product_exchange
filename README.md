# POS Product Exchange

Odoo 17 Community module that adds an exchange-oriented workflow to the
Point of Sale interface and stores exchange records in the backend.

## Current scope

The module currently supports this flow:

1. A cashier clicks **Exchange** beside the native POS **Refund** button.
2. The module opens a paid-order browser based on Odoo's `TicketScreen`.
3. The cashier searches for an order and selects an eligible product line.
4. A negative line for the original product is added to the current POS order.
5. The next positive product added while exchange mode is active is treated as
   the replacement product.
6. When the POS order is validated, exchange metadata is sent to the backend.
7. Odoo creates a `pos.exchange.record` and related exchange lines.

The module does not replace or modify Odoo core files.

## Features

- Exchange button added to `ProductScreen` after `RefundButton`.
- Paid-order search and pagination using Odoo's native POS mechanics.
- Order-detail popup showing receipt, customer, cashier, date, total, and lines.
- Eligibility check that prevents selecting a line whose remaining quantity is
  zero.
- Negative return line and replacement-product tracking in the frontend.
- Exchange reference sequence in the `EXC/00001` format.
- Backend exchange header and line models.
- Exchange-record list, form, search, date filter, status filters, and grouping
  by shop, customer, cashier, or status.
- Exchange data attached to the validated POS order through `exchange_data`.
- POS Closing Session Cash Denominations (1000, 500, 200, 100, 50, 20, 10, 5, 2, and 1 BDT).
- Cash payment amount displayed in the closing session table above City Bank.
- Simplified branch-specific cash labels to "Cash" in the closing session interface.
- Real-time cash denomination total validation against the rounded cash payment amount.
- Rounding rule applied: amounts below 0.50 round down, and 0.50 or above round up.
- Rejection and restore of previous valid quantity with validation warning on excessive cash entry.
- Prevention of session closing when cash denomination total exceeds the cash amount.
- Existing accounting and payment amounts remain completely unchanged.

## Important limitations

This is not yet a complete production-grade exchange implementation.

- The cashier can leave the exchange flow before selecting a replacement.
- The return line is not linked to Odoo's native `refunded_orderline_id`, so
  original order `refunded_qty` tracking is not updated by this module.
- Exchange data is generated in the browser and financial values are currently
  accepted by the backend without recalculation.
- The backend validates the source order/line relationship, but does not yet
  fully validate order state, company/POS scope, quantities, products, or
  submitted totals.
- The replacement is inferred from the next positive product line; there is no
  dedicated replacement screen or quantity workflow.
- Exchange records are created only after the exchange POS order is validated.
- There are no automated module tests.

Use the feature only after confirming that its refund, stock, accounting, and
multi-company behavior matches the business process.

## Compatibility

- Odoo 17 Community
- OWL-based POS frontend
- Dependency: `point_of_sale`
- License: LGPL-3

## Installation

1. Place `kio_pos_product_exchange` in an Odoo addons path.
2. Update the Apps list and install **POS Product Exchange**.
3. Restart Odoo and refresh the POS browser assets if necessary.

To upgrade an existing installation:

```bash
odoo-bin -d <database> -u kio_pos_product_exchange
```

## Usage

1. Open a POS session.
2. Go to the Product Screen and click **Exchange**.
3. Search or browse the paid orders.
4. Select an order and choose an eligible product line.
5. Add the replacement product to the current order.
6. Review and validate the POS order.

The resulting records are available under:

**Point of Sale → Exchange Records**

## POS Closing Session: Cash Denomination & Verification

The module extends the POS session closing flow (`ClosePosPopup`) with cash denomination tracking and validation:

- **1 BDT Cash Denomination**: Added the 1 BDT denomination note to the cash denomination table immediately following the 2 BDT note, supporting 1000, 500, 200, 100, 50, 20, 10, 5, 2, and 1 BDT.
- **Cash Payment Amount Display**: A dedicated Cash payment row is positioned directly above City Bank and other payment methods in the payment overview table, displaying the current session's actual cash sales amount (`payment_amount`).
- **Simplified Cash Label**: Branch-specific cash payment method names (e.g. `JOYDEVPUR Cash`, `BCDL-64 Cash`) are cleanly simplified to **"Cash"** for consistent presentation.
- **Immediate Input Validation & Reversion**: Whenever a cashier modifies any denomination quantity, the combined total across all denomination inputs is validated in real time against the session's cash payment amount.
- **Validation Warning**: If an input causes the denomination total to exceed the cash payment amount, the excessive input is rejected, the input field instantly reverts to its previous valid quantity, and an error warning is displayed:
  > *"Total cash denomination amount cannot exceed the cash amount."*
- **Allowed Thresholds**: Quantities yielding combined totals equal to or less than the cash payment amount are accepted.
- **Rounding Rule**: Fractional cash amounts are handled using currency precision:
  - Fractional values **below 0.50 round down** to the nearest integer.
  - Fractional values of **0.50 or above round up** to the nearest integer.
- **Session Closing Enforcement**: The module prevents closing the POS session if the cash denomination total exceeds the cash payment amount, validated both on the frontend and enforced by backend constraints.
- **Accounting & Payment Integrity**: Existing journal entries, payment method configurations, accounting balances, and financial moves remain completely unaffected and unchanged.

## Backend models

### `pos.exchange.record`

Stores the exchange reference, original order, exchange order, customer,
session, POS, cashier, date, totals, difference, status, and exchange lines.

### `pos.exchange.record.line`

Stores the original product/quantity/price, replacement product/quantity/price,
and the line difference supplied by the POS frontend.

### `pos.cash.denomination`

Stores the cash denomination reference (`CD/00001`), POS session, POS config,
closing user, closing date, total notes count, and total counted amount.

### `pos.cash.denomination.line`

Stores individual note denominations (1000, 500, 200, 100, 50, 20, 10, 5, 2, 1 BDT),
note quantity, and the calculated line amount.

### `pos.order` extensions

The module adds:

- `is_exchange_order`
- `source_order_id`
- `source_order_line_id`
- `exchange_record_id`

## Module structure

```text
kio_pos_product_exchange/
├── __manifest__.py
├── models/
│   ├── pos_cash_denomination.py
│   ├── pos_config.py
│   ├── pos_exchange_record.py
│   ├── pos_order.py
│   ├── pos_product_information.py
│   └── pos_session.py
├── security/
│   ├── ir.model.access.csv
│   ├── pos_cash_denomination_rules.xml
│   └── pos_exchange_record_rules.xml
├── data/
│   ├── pos_cash_denomination_sequence.xml
│   ├── pos_exchange_adjustment_product.xml
│   └── pos_exchange_sequence.xml
├── views/
│   ├── cash_denomination_views.xml
│   ├── menu_views.xml
│   └── pos_config_views.xml
└── static/src/
    ├── js/
    │   ├── closing_cash_denominations.js
    │   ├── exchange_button.js
    │   ├── exchange_details_popup.js
    │   ├── exchange_flow.js
    │   ├── exchange_order.js
    │   ├── exchange_payment.js
    │   ├── exchange_screen.js
    │   ├── internal_product_visibility.js
    │   └── product_information.js
    ├── scss/
    │   ├── closing_cash_denominations.scss
    │   ├── exchange_record.scss
    │   ├── exchange_screen.scss
    │   ├── pos_exchange_receipt.scss
    │   └── product_information.scss
    └── xml/
        ├── closing_cash_denominations.xml
        ├── exchange_button.xml
        ├── exchange_receipt.xml
        ├── exchange_screen.xml
        └── product_information.xml
```

## Technical implementation

- `ExchangeButton` registers through `ProductScreen.addControlButton`.
- `ExchangeScreen` extends the native `TicketScreen` and is registered in the
  `pos_screens` registry.
- `PosStore` and `Order` are patched to track replacement selection and export
  `exchange_data` with the POS order JSON.
- `pos.order._process_order()` creates an exchange record after a validated
  exchange order is processed.
- `ClosePosPopup` is patched to integrate cash denomination inputs, real-time total
  validation against `props.default_cash_details.payment_amount`, and automatic counted cash synchronization.
- Real-time input rejection restores the previous valid quantity and presents an
  error popup if the total exceeds the rounded cash payment amount.
- `pos.session` and `pos.cash.denomination` enforce validation constraints on session closing.
- Access is currently granted to the Point of Sale user group for reading and
  creating exchange records; users cannot edit or delete them through access
  rights.

## Author

Md Rakib Hasan
