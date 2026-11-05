/** @odoo-module */

import { Component, useState, useEffect } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { ProductsWidget } from "@point_of_sale/app/screens/product_screen/product_list/product_list";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { AbstractAwaitablePopup } from "@point_of_sale/app/popup/abstract_awaitable_popup";
import { ErrorPopup } from "@point_of_sale/app/errors/popups/error_popup";
import { useService } from "@web/core/utils/hooks";
import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";

export class ProductInformationButton extends Component {
    static template = "kio_pos_product_exchange.ProductInformationButton";
    static props = {};

    setup() {
        this.pos = usePos();
        this.popup = useService("popup");
    }

    click() {
        this.popup.add(CrossBranchProductInformationPopup);
    }
}

/**
 * Shared branch-wise stock table. Shows positive-stock branches by default
 * with a "Show All Warehouses" toggle; each row reports the branch, the
 * available quantity (On Hand - Reserved) and a stock status.
 */
export class WarehouseStockList extends Component {
    static template = "kio_pos_product_exchange.WarehouseStockList";
    static props = {
        stockByWarehouse: { type: Array, required: true },
    };

    setup() {
        this.state = useState({
            showAllWarehouses: false,
        });
    }

    get visibleWarehouses() {
        const warehouses = this.props.stockByWarehouse || [];
        if (this.state.showAllWarehouses) {
            return warehouses;
        }
        return warehouses.filter((stock) => Number(stock.available_qty || 0) > 0);
    }

    get hiddenWarehouseCount() {
        const warehouses = this.props.stockByWarehouse || [];
        if (this.state.showAllWarehouses) {
            return 0;
        }
        return warehouses.filter((stock) => Number(stock.available_qty || 0) <= 0).length;
    }

    toggleShowAllWarehouses() {
        this.state.showAllWarehouses = !this.state.showAllWarehouses;
    }

    formatQuantity(quantity) {
        return Number(quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
    }
}

export class CrossBranchProductInformationPopup extends AbstractAwaitablePopup {
    static template = "kio_pos_product_exchange.CrossBranchProductInformationPopup";
    static components = { WarehouseStockList };
    static defaultProps = {
        title: _t("Product Information"),
        confirmKey: false,
        cancelKey: "Escape",
    };

    setup() {
        super.setup();
        this.pos = usePos();
        this.orm = useService("orm");
        this.state = useState({
            query: "",
            products: [],
            searched: false,
            loading: false,
            error: "",
        });
    }

    onQueryInput(event) {
        this.state.query = event.target.value;
    }

    async search() {
        const query = this.state.query.trim();
        this.state.searched = true;
        this.state.error = "";
        if (!query) {
            this.state.products = [];
            return;
        }

        this.state.loading = true;
        try {
            this.state.products = await this.orm.call(
                "pos.session",
                "search_cross_branch_product_information",
                [this.pos.pos_session.id, query]
            );
        } catch (error) {
            this.state.products = [];
            this.state.error = error.data?.message || error.message || _t("Unable to search products.");
        } finally {
            this.state.loading = false;
        }
    }
}

/**
 * Read-only single-product branch stock popup, opened from the product card
 * information icon.
 */
export class CrossBranchProductStockPopup extends AbstractAwaitablePopup {
    static template = "kio_pos_product_exchange.CrossBranchProductStockPopup";
    static components = { WarehouseStockList };
    static defaultProps = {
        title: _t("Stock by Branch"),
        confirmKey: false,
        cancelKey: "Escape",
    };

    setup() {
        super.setup();
        this.pos = usePos();
        this.orm = useService("orm");
        this.state = useState({
            loading: true,
            error: "",
            info: null,
        });
        useEffect(() => {
            this.loadInfo();
        }, () => []);
    }

    async loadInfo() {
        try {
            this.state.info = await this.orm.call(
                "pos.session",
                "get_product_branch_stock_information",
                [this.pos.pos_session.id, this.props.product.id]
            );
        } catch (error) {
            this.state.error =
                error.data?.message || error.message || _t("Unable to load branch stock information.");
        } finally {
            this.state.loading = false;
        }
    }

    formatQuantity(quantity) {
        return Number(quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
    }
}

patch(ProductsWidget.prototype, {
    setup() {
        super.setup(...arguments);
        this._crossBranchFetched = new Set();
        // Typeahead for products that are out of stock in this branch but
        // available in another authorised branch. The products are loaded into
        // the POS database (like "Search more" does) so the normal search box
        // can find them. They remain unsellable in this branch.
        useEffect(
            () => {
                const word = this.searchWord;
                if (
                    word &&
                    word.length >= 2 &&
                    !this._crossBranchFetched.has(word)
                ) {
                    this._crossBranchFetched.add(word);
                    this.loadCrossBranchProducts(word);
                }
            },
            () => [this.searchWord]
        );
    },

    async loadCrossBranchProducts(word) {
        try {
            const products = await this.orm.call(
                "pos.session",
                "get_cross_branch_pos_products",
                [this.pos.pos_session.id, word]
            );
            if (products && products.length) {
                this.pos._loadProductProduct(products);
                this.updateProductList();
            }
        } catch (error) {
            console.warn("Cross-branch product search failed", error);
            this.notification?.add?.(
                _t("Could not load products available in other branches."),
                3000
            );
        }
    },

    async onProductInfoClick(product) {
        this.popup.add(CrossBranchProductStockPopup, { product });
    },
});

patch(PosStore.prototype, {
    async addProductToCurrentOrder(product, options = {}) {
        if (Number.isInteger(product)) {
            product = this.db.get_product_by_id(product);
        }
        // Products fetched only because they have stock in another branch are
        // searchable, but must never be sold from this branch's POS.
        const localQty = product?.kio_cross_branch_local_qty;
        if (
            product &&
            localQty !== undefined &&
            localQty !== null &&
            Number.isFinite(Number(localQty)) &&
            Number(localQty) <= 0
        ) {
            let body = _t(
                "%s is out of stock in this branch and cannot be sold here.",
                product.display_name
            );
            if (product.kio_cross_branch_availability) {
                body += "\n" + _t("Available at: %s", product.kio_cross_branch_availability);
            }
            await this.popup.add(ErrorPopup, {
                title: _t("Out of Stock in This Branch"),
                body,
            });
            return;
        }
        return super.addProductToCurrentOrder(product, options);
    },
});

ProductScreen.addControlButton({
    component: ProductInformationButton,
    position: ["after", "RefundButton"],
    condition: function () {
        return true;
    },
});
