import { httpApi } from './http'
import { mockApi } from './mock'
import type { DataSource } from './types'

const useMock = import.meta.env.VITE_USE_MOCK !== 'false'

export const api: DataSource = useMock ? mockApi : httpApi
export const isMockMode = useMock

export * from './types'
