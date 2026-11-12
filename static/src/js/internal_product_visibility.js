/** @odoo-module */

import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { patch } from "@web/core/utils/patch";

const EXCHANGE_ADJUSTMENT_CODE = "POS_EXCHANGE_ADJUSTMENT";

patch(ProductScreen.prototype, {
    async _getProductByBarcode(code) {
        const product = await super._getProductByBarcode(...arguments);
        return product?.default_code === EXCHANGE_ADJUSTMENT_CODE ? undefined : product;
    },
});
