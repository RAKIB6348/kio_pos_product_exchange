/** @odoo-module */

import { Component } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";

export class ExchangeButton extends Component {
    static template = "kio_pos_product_exchange.ExchangeButton";

    setup() {
        this.pos = usePos();
    }

    click() {
        this.pos.exchangeState = null;
        this.pos.showScreen("ExchangeScreen", {
            ui: { filter: "SYNCED", searchDetails: this.pos.getDefaultSearchDetails() },
            destinationOrder: this.pos.get_order(),
            exchangeMode: true,
        });
    }
}

ProductScreen.addControlButton({
    component: ExchangeButton,
    position: ["after", "RefundButton"],
    condition: function () {
        return true;
    },
});