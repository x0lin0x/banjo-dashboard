import { IconBug } from '@tabler/icons-react';

const trading = {
  id: 'trading',
  title: 'Trading',
  type: 'group',
  children: [
    {
      id: 'test-page',
      title: 'Test',
      type: 'item',
      url: '/test',
      icon: IconBug,
      breadcrumbs: false
    }
  ]
};

export default trading;
