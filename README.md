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

## Backend models

### `pos.exchange.record`

Stores the exchange reference, original order, exchange order, customer,
session, POS, cashier, date, totals, difference, status, and exchange lines.

### `pos.exchange.record.line`

Stores the original product/quantity/price, replacement product/quantity/price,
and the line difference supplied by the POS frontend.

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
│   ├── pos_exchange_record.py
│   └── pos_order.py
├── security/ir.model.access.csv
├── data/pos_exchange_sequence.xml
├── views/menu_views.xml
└── static/src/
    ├── js/
    │   ├── exchange_button.js
    │   ├── exchange_details_popup.js
    │   ├── exchange_flow.js
    │   ├── exchange_order.js
    │   └── exchange_screen.js
    ├── scss/exchange_screen.scss
    └── xml/
        ├── exchange_button.xml
        └── exchange_screen.xml
```

## Technical implementation

- `ExchangeButton` registers through `ProductScreen.addControlButton`.
- `ExchangeScreen` extends the native `TicketScreen` and is registered in the
  `pos_screens` registry.
- `PosStore` and `Order` are patched to track replacement selection and export
  `exchange_data` with the POS order JSON.
- `pos.order._process_order()` creates an exchange record after a validated
  exchange order is processed.
- Access is currently granted to the Point of Sale user group for reading and
  creating exchange records; users cannot edit or delete them through access
  rights.

## Author

Md Rakib Hasan
