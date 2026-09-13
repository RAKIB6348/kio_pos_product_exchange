/** @odoo-module */

import { Component } from "@odoo/owl";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";

export class ExchangeButton extends Component {
    static template = "kio_pos_product_exchange.ExchangeButton";

    click() {
        console.log("Exchange button clicked");
    }
}

ProductScreen.addControlButton({
    component: ExchangeButton,
    position: ["after", "RefundButton"],
    condition: function () {
        return true;
    },
});