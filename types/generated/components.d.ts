import type { Schema, Struct } from '@strapi/strapi';

export interface OrderCourseOrderItem extends Struct.ComponentSchema {
  collectionName: 'components_order_course_order_items';
  info: {
    displayName: 'CourseOrderItem';
    icon: 'stack';
  };
  attributes: {};
}

export interface OrderProductOrderItem extends Struct.ComponentSchema {
  collectionName: 'components_order_product_order_items';
  info: {
    displayName: 'ProductOrderItem';
    icon: 'shoppingCart';
  };
  attributes: {
    product: Schema.Attribute.Relation<'oneToOne', 'api::product.product'>;
    quantity: Schema.Attribute.Integer;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'order.course-order-item': OrderCourseOrderItem;
      'order.product-order-item': OrderProductOrderItem;
    }
  }
}
