/** @odoo-module */

import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { patch } from "@web/core/utils/patch";

patch(PaymentScreen.prototype, {
    async validateOrder() {
        if (
            this.currentOrder?.exchangeState?.exchangeType === "new_product" &&
            !(await this.pos.validateExchangeBeforePayment(this.currentOrder))
        ) {
            return;
        }
        return super.validateOrder(...arguments);
    },

    async onMounted() {
        if (!this.currentOrder?.autoValidateExchange) {
            return super.onMounted(...arguments);
        }
        this.currentOrder.autoValidateExchange = false;
        await this.validateOrder(false);
    },
});
