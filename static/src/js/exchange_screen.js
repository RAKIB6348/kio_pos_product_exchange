/** @odoo-module */

import { TicketScreen } from "@point_of_sale/app/screens/ticket_screen/ticket_screen";
import { ErrorPopup } from "@point_of_sale/app/errors/popups/error_popup";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";

export class ExchangeScreen extends TicketScreen {
    static template = "point_of_sale.TicketScreen";
    static storeOnOrder = false;
    static numpadActionName = _t("Exchange");

    setup() {
        super.setup();
        this.exchangeMode = true;
    }

    async onDoRefund() {
        this.popup.add(ErrorPopup, {
            title: _t("Exchange"),
            body: _t("Product exchange is not implemented yet."),
        });
    }
}

registry.category("pos_screens").add("ExchangeScreen", ExchangeScreen);