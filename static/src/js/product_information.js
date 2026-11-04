/** @odoo-module */

import { Component, useState } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { AbstractAwaitablePopup } from "@point_of_sale/app/popup/abstract_awaitable_popup";
import { useService } from "@web/core/utils/hooks";
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

export class CrossBranchProductInformationPopup extends AbstractAwaitablePopup {
    static template = "kio_pos_product_exchange.CrossBranchProductInformationPopup";
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
            showAllWarehouses: false,
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

    toggleShowAllWarehouses() {
        this.state.showAllWarehouses = !this.state.showAllWarehouses;
    }

    visibleWarehouses(product) {
        const warehouses = product.stock_by_warehouse || [];
        if (this.state.showAllWarehouses) {
            return warehouses;
        }
        return warehouses.filter((stock) => Number(stock.available_qty || 0) > 0);
    }

    hiddenWarehouseCount(product) {
        const warehouses = product.stock_by_warehouse || [];
        if (this.state.showAllWarehouses) {
            return 0;
        }
        return warehouses.filter((stock) => Number(stock.available_qty || 0) <= 0).length;
    }

    formatQuantity(quantity) {
        return Number(quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
    }
}

ProductScreen.addControlButton({
    component: ProductInformationButton,
    position: ["after", "RefundButton"],
    condition: function () {
        return true;
    },
});
