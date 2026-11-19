'use strict';

const { applyLabels } = require('../../src/services/shippingCmLabels');

describe('shippingCmLabels', () => {
  it('sets persian edit/list labels without dropping other metadata', () => {
    const { changed, metadatas } = applyLabels(
      {
        costMode: { edit: { editable: true, label: 'costMode' }, list: { label: 'costMode' } },
      },
      { costMode: 'حالت هزینه ارسال' },
    );

    expect(changed).toBe(true);
    expect(metadatas.costMode.edit).toEqual({
      editable: true,
      label: 'حالت هزینه ارسال',
    });
    expect(metadatas.costMode.list.label).toBe('حالت هزینه ارسال');
  });

  it('reports unchanged when labels already match', () => {
    const { changed } = applyLabels(
      {
        shippingOrigin: {
          edit: { label: 'مبدأ ارسال' },
          list: { label: 'مبدأ ارسال' },
        },
      },
      { shippingOrigin: 'مبدأ ارسال' },
    );
    expect(changed).toBe(false);
  });

  it('sets editable false and description for readonly fields such as rialPerNoorForShipping', () => {
    const { changed, metadatas } = applyLabels(
      {
        rialPerNoorForShipping: {
          edit: { editable: true, label: 'rialPerNoorForShipping' },
          list: { label: 'rialPerNoorForShipping' },
        },
      },
      { rialPerNoorForShipping: 'نرخ ریال به نور برای ارسال' },
      ['rialPerNoorForShipping'],
      { rialPerNoorForShipping: 'تنها به صورت نمایشی از دیتابیس بای‌مانی خوانده می‌شود.' },
    );

    expect(changed).toBe(true);
    expect(metadatas.rialPerNoorForShipping.edit).toEqual({
      editable: false,
      label: 'نرخ ریال به نور برای ارسال',
      description: 'تنها به صورت نمایشی از دیتابیس بای‌مانی خوانده می‌شود.',
    });
  });
});
