import type { Schema, Struct } from '@strapi/strapi';

export interface CoursePartsChapter extends Struct.ComponentSchema {
  collectionName: 'components_course_parts_chapters';
  info: {
    description: '\u0641\u0635\u0644\u200C\u0647\u0627\u06CC \u062F\u0648\u0631\u0647 \u0622\u0645\u0648\u0632\u0634\u06CC \u0628\u0647 \u0647\u0645\u0631\u0627\u0647 \u0642\u06CC\u0645\u062A \u0648 \u062F\u0631\u0648\u0633 \u062F\u0627\u062E\u0644\u06CC';
    displayName: 'chapter';
    icon: 'bulletList';
  };
  attributes: {
    duration: Schema.Attribute.String & Schema.Attribute.DefaultTo<'00:00'>;
    lessons: Schema.Attribute.Component<'course-parts.lesson', true>;
    price: Schema.Attribute.Decimal & Schema.Attribute.DefaultTo<0>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

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
      Schema.Attribute.DefaultTo<false>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    videoUrl: Schema.Attribute.String;
  };
}

export interface FormQuestion extends Struct.ComponentSchema {
  collectionName: 'components_form_questions';
  info: {
    description: '\u0633\u0648\u0627\u0644\u0627\u062A \u0641\u0631\u0645 \u067E\u06CC\u0634\u200C\u0646\u06CC\u0627\u0632';
    displayName: 'Question';
    icon: 'question-circle';
  };
  attributes: {
    fieldType: Schema.Attribute.Enumeration<
      ['text', 'number', 'textarea', 'select']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'text'>;
    isRequired: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    key: Schema.Attribute.String & Schema.Attribute.Required;
    label: Schema.Attribute.String & Schema.Attribute.Required;
    options: Schema.Attribute.JSON;
    placeholder: Schema.Attribute.String;
  };
}

export interface OrderCourseOrderItem extends Struct.ComponentSchema {
  collectionName: 'components_order_course_order_items';
  info: {
    displayName: 'CourseOrderItem';
    icon: 'stack';
  };
  attributes: {
    chapterId: Schema.Attribute.Integer;
    courseId: Schema.Attribute.Integer;
    itemUrl: Schema.Attribute.String;
    price: Schema.Attribute.Decimal;
    slug: Schema.Attribute.String;
    title: Schema.Attribute.String;
  };
}

export interface OrderProductOrderItem extends Struct.ComponentSchema {
  collectionName: 'components_order_product_order_items';
  info: {
    displayName: 'ProductOrderItem';
    icon: 'shoppingCart';
  };
  attributes: {
    itemUrl: Schema.Attribute.String;
    price: Schema.Attribute.Decimal;
    productId: Schema.Attribute.Integer;
    quantity: Schema.Attribute.Integer;
    slug: Schema.Attribute.String;
    title: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'course-parts.chapter': CoursePartsChapter;
      'course-parts.lesson': CoursePartsLesson;
      'form.question': FormQuestion;
      'order.course-order-item': OrderCourseOrderItem;
      'order.product-order-item': OrderProductOrderItem;
    }
  }
}
