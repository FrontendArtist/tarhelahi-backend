import type { Schema, Struct } from '@strapi/strapi';

export interface CoursePartsLesson extends Struct.ComponentSchema {
  collectionName: 'components_course_parts_lessons';
  info: {
    displayName: 'lesson';
  };
  attributes: {
    audioUrl: Schema.Attribute.String;
    duration: Schema.Attribute.String & Schema.Attribute.DefaultTo<'00:00'>;
    isFree: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    videoUrl: Schema.Attribute.String;
  };
}

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
    quantity: Schema.Attribute.Integer;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'course-parts.lesson': CoursePartsLesson;
      'order.course-order-item': OrderCourseOrderItem;
      'order.product-order-item': OrderProductOrderItem;
    }
  }
}
