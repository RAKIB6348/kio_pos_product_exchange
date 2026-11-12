/** @odoo-module */

import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { PosStore } from "@point_of_sale/app/store/pos_store";

QUnit.module("POS Product Exchange", () => {
    QUnit.test("exchange adjustment cannot be selected by barcode from cache", async (assert) => {
        const adjustment = { default_code: "POS_EXCHANGE_ADJUSTMENT" };
        const screen = {
            pos: { db: { get_product_by_barcode: () => adjustment } },
        };

        const product = await ProductScreen.prototype._getProductByBarcode.call(screen, {
            base_code: "ADJUSTMENT-BARCODE",
        });

        assert.notOk(product);
    });

    QUnit.test("exchange adjustment cannot be selected through packaging barcode lookup", async (assert) => {
        const adjustment = { default_code: "POS_EXCHANGE_ADJUSTMENT" };
        const screen = {
            pos: {
                db: {
                    get_product_by_barcode: () => undefined,
                    get_product_by_id: () => adjustment,
                },
                _addProducts: async () => {},
            },
            orm: { silent: { call: async () => ({ product_id: [17], packaging: [{ id: 1 }] }) } },
        };

        const product = await ProductScreen.prototype._getProductByBarcode.call(screen, {
            base_code: "ADJUSTMENT-PACKAGING-BARCODE",
        });

        assert.notOk(product);
    });

    QUnit.test("ordinary products remain selectable by barcode", async (assert) => {
        const ordinaryProduct = { default_code: "NORMAL_PRODUCT" };
        const screen = {
            pos: { db: { get_product_by_barcode: () => ordinaryProduct } },
        };

        const product = await ProductScreen.prototype._getProductByBarcode.call(screen, {
            base_code: "NORMAL-BARCODE",
        });

        assert.strictEqual(product, ordinaryProduct);
    });

    QUnit.test("exchange adjustment loads internally when normal getProductById is filtered", async (assert) => {
        const productData = {
            id: 17,
            default_code: "POS_EXCHANGE_ADJUSTMENT",
            available_in_pos: false,
        };
        const loadedProducts = {};
        const calls = [];
        const pos = {
            pos_session: { id: 5 },
            exchangeAdjustmentProduct: null,
            exchangeAdjustmentProductPromise: null,
            orm: {
                call: async (model, method, args) => {
                    calls.push(method);
                    return method === "get_exchange_adjustment_product" ? 17 : productData;
                },
            },
            getProductById: async () => undefined,
            _loadProductProduct: (products) => {
                for (const product of products) {
                    loadedProducts[product.id] = product;
                }
            },
            db: { get_product_by_id: (id) => loadedProducts[id] },
        };

        const product = await PosStore.prototype.getExchangeAdjustmentProduct.call(pos);

        assert.strictEqual(product, productData);
        assert.deepEqual(calls, [
            "get_exchange_adjustment_product",
            "get_exchange_adjustment_product_data",
        ]);
        assert.notOk(product.available_in_pos);
    });
});
