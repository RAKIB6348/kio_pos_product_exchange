/** @odoo-module */

import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { patch } from "@web/core/utils/patch";

patch(PosStore.prototype, {
    async finalizeZeroPayExchange(order) {
        const context = {
            currentOrder: order,
            paymentLines: order.get_paymentlines(),
            pos: this,
            env: this.env,
            popup: this.env.services.popup,
            report: this.env.services.report,
            printer: this.env.services.printer,
            hardwareProxy: this.env.services.hardware_proxy,
            nextScreen: "ReceiptScreen",
        };
        context.shouldDownloadInvoice = (...args) =>
            PaymentScreen.prototype.shouldDownloadInvoice.apply(context, args);
        context._postPushOrderResolve = (...args) =>
            PaymentScreen.prototype._postPushOrderResolve.apply(context, args);
        context.postPushOrderResolve = (...args) =>
            PaymentScreen.prototype.postPushOrderResolve.apply(context, args);
        context.afterOrderValidation = (...args) =>
            PaymentScreen.prototype.afterOrderValidation.apply(context, args);

        // Reuse Odoo's standard finalization pipeline without navigating through
        // PaymentScreen for an exchange that has no amount due.
        await PaymentScreen.prototype._finalizeValidation.call(context);
    },
});

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
