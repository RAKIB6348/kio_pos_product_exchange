/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";

patch(PosStore.prototype, {
    clearExchangeState() {
        this.exchangeState = null;
    },
    async addProductToCurrentOrder(product, options = {}) {
        const exchangeState = this.exchangeState;
        const order = this.get_order();
        const replacementProduct = Number.isInteger(product)
            ? this.db.get_product_by_id(product)
            : product;
        const existingLineIds = new Set(order?.get_orderlines().map((line) => line.id) || []);
        const result = await super.addProductToCurrentOrder(product, options);
        if (exchangeState?.waitingForReplacement) {
            const currentOrder = this.get_order();
            const replacementLine = currentOrder?.get_selected_orderline()?.product === replacementProduct
                ? currentOrder.get_selected_orderline()
                : currentOrder?.get_orderlines().find(
                      (line) =>
                          line.product === replacementProduct &&
                          !existingLineIds.has(line.id) &&
                          line !== exchangeState.returnLine
                  );
            if (replacementLine) {
                this.exchangeState = Object.assign({}, exchangeState, {
                    replacementProduct: replacementLine.product,
                    replacementOrderline: replacementLine,
                    waitingForReplacement: false,
                });
            }
        }
        return result;
    },
});
