/** @odoo-module */

import { TicketScreen } from "@point_of_sale/app/screens/ticket_screen/ticket_screen";
import { ErrorPopup } from "@point_of_sale/app/errors/popups/error_popup";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
import { onWillUnmount } from "@odoo/owl";
import { ExchangeDetailsPopup } from "./exchange_details_popup";

export class ExchangeScreen extends TicketScreen {
    static template = "point_of_sale.TicketScreen";
    static storeOnOrder = false;
    static numpadActionName = _t("Exchange");

    setup() {
        super.setup();
        this.exchangeMode = true;
        onWillUnmount(() => {
            if (!this.pos.exchangeState?.waitingForReplacement) {
                this.pos.exchangeState = null;
            }
        });
    }

    isLineEligibleForExchange(line) {
        const remaining = line.get_quantity() - (line.refunded_qty || 0);
        return !this.pos.isProductQtyZero(remaining);
    }

    async onClickOrder(clickedOrder) {
        const { confirmed, payload } = await this.popup.add(ExchangeDetailsPopup, {
            order: clickedOrder,
            partner: this.getPartner(clickedOrder),
            cashier: this.getCashier(clickedOrder),
            date: this.getDate(clickedOrder),
            total: this.getTotal(clickedOrder),
            canExchangeLine: (line) => this.isLineEligibleForExchange(line),
        });
        if (confirmed && payload?.orderline) {
            const orderline = payload.orderline;
            const order = this.pos.get_order() || this.pos.add_new_order();
            const returnLine = await order.add_product(orderline.product, {
                quantity: -orderline.get_quantity(),
                price: orderline.get_unit_price(),
                merge: false,
            });
            returnLine.is_exchange_return = true;
            this.pos.exchangeState = {
                sourceOrder: orderline.order,
                sourceOrderName: orderline.order.name,
                sourceOrderline: orderline,
                product: orderline.product,
                quantity: orderline.get_quantity(),
                price: orderline.get_unit_price(),
                returnLine,
                exchangeOrder: order,
                waitingForReplacement: true,
                replacementProduct: null,
            };
            this.pos.showScreen("ProductScreen");
        }
    }

    async onDoRefund() {
        this.popup.add(ErrorPopup, {
            title: _t("Exchange"),
            body: _t("Product exchange is not implemented yet."),
        });
    }
}

registry.category("pos_screens").add("ExchangeScreen", ExchangeScreen);