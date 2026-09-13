# POS Product Exchange

Odoo 17 Community module for exchanging products from Point of Sale orders.

## Overview

This module adds an **Exchange** button to the POS **Product Screen**, placed
directly beside the standard **Refund** button:

```
[ Refund ] [ Exchange ] [ Customer Note ]
```

Clicking **Exchange** opens a previous-orders screen where the cashier can
browse, search, and select completed/paid POS orders.

> **Note:** The actual product-exchange workflow (adding returned lines,
> calculating price differences, stock movement, etc.) is not implemented yet.
> This release covers the button and the previous-order selection flow only.

## Features

- **Exchange button** on the Product Screen, always visible (no product needs
  to be selected), visually matching the native Refund button.
- **Previous orders screen** that reuses Odoo's standard `TicketScreen` UI and
  shows: Date, Receipt Number, Order number, Customer, Cashier, Total, Status.
- Paid orders are loaded from the backend with the standard Odoo mechanics
  (`search_paid_order_ids`), including search bar and pagination.
- Exchange and Refund are kept separate: a dedicated `ExchangeScreen` with an
  `exchangeMode` flag replaces the "Refund" action label and prevents any
  refund process from being triggered.

## Compatibility

- Odoo 17 Community (OWL `point_of_sale` frontend)
- No Odoo core files are modified.

## Installation

1. Copy this folder to your addons path, e.g. `custom_addons/pos_addons/`.
2. Update the module list in Apps, then install **POS Product Exchange**.
3. Make sure the module assets are picked up (see Upgrade).

## Usage

1. Open a POS session and go to the Product Screen.
2. Click **Exchange** (next to Refund).
3. Browse/search the list of paid orders and click one to select it.
4. Back returns to the Product Screen.

## Module structure

```
kio_pos_product_exchange/
├─ __manifest__.py
├─ static/src/js/
│  ├─ exchange_button.js     # Exchange button (ProductScreen.addControlButton)
│  └─ exchange_screen.js     # ExchangeScreen (extends TicketScreen, pos_screens)
└─ static/src/xml/
   └─ exchange_button.xml    # Button template
```

## Technical notes

- The button is added via `ProductScreen.addControlButton` with
  `position: ["after", "RefundButton"]` — the official Odoo 17 extension
  mechanism. No template patching or DOM manipulation is used.
- The screen is registered in the `pos_screens` registry as `ExchangeScreen`
  and subclasses `point_of_sale.TicketScreen`, reusing its native template,
  search, and pagination.
- `ExchangeScreen` overrides `numpadActionName` (label) and `onDoRefund`
  (blocks the refund flow) so Exchange mode stays distinct from Refund mode.

## Upgrade

```bash
odoo-bin -d <your_db> -u kio_pos_product_exchange
```

After upgrading, restart the Odoo service and hard-refresh the browser
(`Ctrl+Shift+R`), then reopen the POS session so the new assets load.

## Author

Md Rakib Hasan