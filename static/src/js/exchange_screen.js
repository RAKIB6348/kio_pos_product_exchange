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
            if (!this.pos.exchangeState?.returnLine) {
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
        if (confirmed && payload?.orderlines?.length) {
            const orderlines = payload.orderlines;
            const orderline = orderlines[0];
            let order = this.pos.get_order() || this.pos.add_new_order();
            if (
                (order.get_orderlines().length || order.get_paymentlines().length)
            ) {
                order = this.pos.add_new_order();
            }
            const exchangeItems = [];
            for (const sourceOrderline of orderlines) {
                const exchangeQty = payload.exchangeQuantities[sourceOrderline.id];
                const returnLine = await order.add_product(sourceOrderline.product, {
                    quantity: -exchangeQty,
                    price: sourceOrderline.get_unit_price(),
                    discount: sourceOrderline.get_discount(),
                    tax_ids: sourceOrderline.get_taxes().map((tax) => tax.id),
                    merge: false,
                });
                returnLine.is_exchange_return = true;
                exchangeItems.push({ sourceOrderline, returnLine, replacementOrderline: null });
            }
            const originalPartner = orderline.order.get_partner();
            if (originalPartner) {
                order.set_partner(originalPartner);
            }
            const exchangeState = {
                sourceOrder: orderline.order,
                sourceOrderName: orderline.order.name,
                sourceOrderline: orderline,
                sourceOrderlines: orderlines,
                product: orderline.product,
                quantity: orderline.get_quantity(),
                price: orderline.get_unit_price(),
                partner: originalPartner,
                returnLine: exchangeItems[0].returnLine,
                returnLines: exchangeItems.map((item) => item.returnLine),
                exchangeItems,
                exchangeOrder: order,
                exchangeType: payload.exchangeChoice,
                oldTotal: payload.totalExchangeValue,
                waitingForReplacement: payload.exchangeChoice !== "same_product",
                replacementProduct: null,
            };
            if (payload.exchangeChoice === "same_product") {
                for (const item of exchangeItems) {
                    item.replacementOrderline = await order.add_product(
                        item.sourceOrderline.product,
                        {
                            quantity: item.sourceOrderline.get_quantity(),
                            price: item.sourceOrderline.get_unit_price(),
                            discount: item.sourceOrderline.get_discount(),
                            tax_ids: item.sourceOrderline.get_taxes().map((tax) => tax.id),
                            merge: false,
                        }
                    );
                }
                exchangeState.replacementProduct = exchangeItems[0].replacementOrderline.product;
                exchangeState.replacementOrderline = exchangeItems[0].replacementOrderline;
                exchangeState.replacementOrderlines = exchangeItems.map(
                    (item) => item.replacementOrderline
                );
            }
            this.pos.exchangeState = exchangeState;
            if (payload.exchangeChoice === "same_product") {
                order.autoValidateExchange = true;
                this.pos.showScreen("PaymentScreen");
            } else {
                this.pos.showScreen("ProductScreen");
            }
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
