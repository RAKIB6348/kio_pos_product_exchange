/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";

patch(PosStore.prototype, {
    clearExchangeState() {
        this.exchangeState = null;
    },
    async addProductToCurrentOrder(product, options = {}) {
        if (this.exchangeState?.waitingForReplacement) {
            if (Number.isInteger(product)) {
                product = this.db.get_product_by_id(product);
            }
            this.exchangeState = Object.assign({}, this.exchangeState, {
                replacementProduct: product,
                waitingForReplacement: false,
            });
            return Promise.resolve();
        }
        return super.addProductToCurrentOrder(product, options);
    },
});