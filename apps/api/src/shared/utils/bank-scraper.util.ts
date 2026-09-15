import { BankProvider, BANK_URL_KEYWORDS } from '../constants/bank.constants'

/**
 * Determines the bank provider based on the terminal's credential URL.
 */
export function getBankProvider(url: string | null | undefined): BankProvider | null {
  if (!url) return null

  for (const [provider, keyword] of Object.entries(BANK_URL_KEYWORDS)) {
    if (url.includes(keyword)) {
      return provider as BankProvider
    }
  }

  return null
}

/**
 * Extracts the unique target identifier from a bank scraping URL.
 * Supports:
 * - Monobank (jar): ?jar=XYZ or /jar/XYZ or /XYZ
 * - PUMB (box): ?box_id=XYZ
 * - PrivatBank (envelope): /send/XYZ
 */
export function extractTargetId(urlStr: string | null | undefined): string | null {
  if (!urlStr) return null

  try {
    const url = new URL(urlStr)
    
    // 1. URL parameters
    const jarParam = url.searchParams.get('jar')
    if (jarParam) return jarParam

    const boxIdParam = url.searchParams.get('box_id')
    if (boxIdParam) return boxIdParam

    // 2. Path matching
    const pathParts = url.pathname.split('/').filter(Boolean)
    if (pathParts.length > 0) {
      return pathParts[pathParts.length - 1]
    }
  } catch {
    // 3. Fallback regex if URL parsing fails
    const match = urlStr.match(/(?:jar=|jar\/|send\.monobank\.ua\/|privat24\.ua\/send\/|box_id=)([a-zA-Z0-9_-]+)/)
    if (match) return match[1]
  }

  return null
}

/**
 * Extracts the sendId specifically for Monobank URLs.
 */
export function extractSendId(monoUrl: string | null | undefined): string | null {
  if (!monoUrl) return null
  const cleanUrl = monoUrl.replace(/&amp;/g, '&')
  try {
    const url = new URL(cleanUrl)
    const sendIdParam = url.searchParams.get('sendId')
    if (sendIdParam) return sendIdParam

    const match = cleanUrl.match(/[?&]sendId=([a-zA-Z0-9_-]+)/)
    if (match) return match[1]
  } catch {
    const match = cleanUrl.match(/[?&]sendId=([a-zA-Z0-9_-]+)/)
    if (match) return match[1]
  }
  return null
}
