/** Huawei Enterprise ICT product lines shown as Engagement products. */
export const HUAWEI_ENTERPRISE_PRODUCTS = [
  'Storage',
  'IdeaHub',
  'Datacom',
  'DWDM',
  'Optical',
  'WLAN',
  'Security',
  'Computing',
  'Cloud',
  'Intelligent Vision',
  'Private Wireless',
] as const

export type HuaweiEnterpriseProduct = (typeof HUAWEI_ENTERPRISE_PRODUCTS)[number]
