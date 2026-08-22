/** Huawei Enterprise ICT product lines shown as Engagement domains. */
export const HUAWEI_ENTERPRISE_DOMAINS = [
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

export type HuaweiEnterpriseDomain = (typeof HUAWEI_ENTERPRISE_DOMAINS)[number]
