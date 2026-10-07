# -*- coding: utf-8 -*-
{
    'name': "POS Product Exchange",
    'summary': "Exchange products from Point of Sale orders",
    'description': """
POS Product Exchange
====================
Allow cashiers to exchange products from validated POS orders.

Key Features:
-------------
* Exchange sold product with another product
* Price difference handling (pay extra / refund)
* Stock and order history tracking
* Simple workflow from POS interface
    """,
    'author': "Md Rakib Hasan",
    'website': "https://github.com/RAKIB6348/kio_pos_product_exchange",
    'category': 'Point of Sale',
    'version': '17.0.1.0.0',
    'license': 'LGPL-3',
    'depends': ['point_of_sale', 'kio_branch_inventory'],
    'data': [
        'security/ir.model.access.csv',
        'security/pos_exchange_record_rules.xml',
        'data/pos_exchange_sequence.xml',
        'data/pos_exchange_adjustment_product.xml',
        'views/menu_views.xml',
    ],
    'demo': [],
    'assets': {
        'point_of_sale._assets_pos': [
            'kio_pos_product_exchange/static/src/xml/*.xml',
            'kio_pos_product_exchange/static/src/js/exchange_button.js',
            'kio_pos_product_exchange/static/src/js/exchange_screen.js',
            'kio_pos_product_exchange/static/src/js/exchange_details_popup.js',
            'kio_pos_product_exchange/static/src/js/exchange_flow.js',
            'kio_pos_product_exchange/static/src/js/exchange_order.js',
            'kio_pos_product_exchange/static/src/js/exchange_payment.js',
            'kio_pos_product_exchange/static/src/js/closing_cash_denominations.js',
            'kio_pos_product_exchange/static/src/scss/exchange_screen.scss',
            'kio_pos_product_exchange/static/src/scss/closing_cash_denominations.scss',
            'kio_pos_product_exchange/static/src/scss/pos_exchange_receipt.scss',
        ],
        'web.assets_backend': [
            'kio_pos_product_exchange/static/src/scss/exchange_record.scss',
        ],
    },
    'installable': True,
    'application': False,
    'auto_install': False,
}
