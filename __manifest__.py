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
    'depends': ['point_of_sale'],
    'data': [
        'security/ir.model.access.csv',
        'views/views.xml',
    ],
    'demo': [
        'demo/demo.xml',
    ],
    'assets': {
        # 'point_of_sale._assets_pos': [
        #     'kio_pos_product_exchange/static/src/js/*.js',
        #     'kio_pos_product_exchange/static/src/xml/*.xml',
        # ],
    },
    'installable': True,
    'application': False,
    'auto_install': False,
}
