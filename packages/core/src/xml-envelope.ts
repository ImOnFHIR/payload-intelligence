// SPDX-License-Identifier: Apache-2.0

import { SaxesParser } from 'saxes'

export const MAX_XML_ELEMENTS = 100_000
export const MAX_XML_ATTRIBUTES = 100_000

export type XmlPolicyViolation = {
  code: string
  description: string
}

const XML_PROHIBITIONS: ReadonlyArray<XmlPolicyViolation & { pattern: RegExp }> = [
  {
    pattern: /<!DOCTYPE\b/i,
    code: 'XML_DOCTYPE_PROHIBITED',
    description: 'XML document type declarations are prohibited.',
  },
  {
    pattern: /<!ENTITY\b/i,
    code: 'XML_ENTITY_PROHIBITED',
    description: 'XML entity declarations are prohibited.',
  },
  {
    pattern: /(?:<\s*[A-Za-z_][\w.-]*:include\b|https?:\/\/www\.w3\.org\/2001\/XInclude)/i,
    code: 'XML_XINCLUDE_PROHIBITED',
    description: 'XML XInclude references are prohibited.',
  },
  {
    pattern: /\b(?:href|src|(?:noNamespace)?schemaLocation)\s*=\s*["'][^"']*(?:https?|ftp):/i,
    code: 'XML_NETWORK_REFERENCE_PROHIBITED',
    description: 'XML network references are prohibited.',
  },
]

export function findXmlPolicyViolation(text: string): XmlPolicyViolation | undefined {
  const match = XML_PROHIBITIONS.find((prohibition) => prohibition.pattern.test(text))
  return match ? { code: match.code, description: match.description } : undefined
}

export type XmlEnvelopeInspection =
  | {
      ok: true
      root: { localName: string; namespaceUri: string }
      elementCount: number
      attributeCount: number
    }
  | {
      ok: false
      issue: XmlPolicyViolation
    }

/**
 * Parse only enough XML to prove well-formedness and identify the namespace-aware
 * root. No text, attribute value, comment, CDATA, or processing-instruction value
 * is retained or returned. DTDs and network-bearing constructs are rejected before
 * this parser is called.
 */
export function inspectXmlEnvelope(text: string): XmlEnvelopeInspection {
  let root: { localName: string; namespaceUri: string } | undefined
  let elementCount = 0
  let attributeCount = 0
  let parseFailed = false

  try {
    const parser = new SaxesParser({ xmlns: true })
    parser.on('opentagstart', () => {
      elementCount += 1
      if (elementCount > MAX_XML_ELEMENTS) throw new XmlLimitError('elements')
    })
    parser.on('attribute', () => {
      attributeCount += 1
      if (attributeCount > MAX_XML_ATTRIBUTES) throw new XmlLimitError('attributes')
    })
    parser.on('opentag', (tag) => {
      root ??= { localName: tag.local, namespaceUri: tag.uri }
    })
    parser.on('doctype', () => {
      parseFailed = true
    })
    parser.on('error', () => {
      parseFailed = true
    })
    parser.write(text).close()
  } catch (cause) {
    if (cause instanceof XmlLimitError) {
      return {
        ok: false,
        issue: cause.kind === 'elements'
          ? {
              code: 'XML_ELEMENT_LIMIT_EXCEEDED',
              description: `XML exceeds the ${MAX_XML_ELEMENTS.toLocaleString('en-US')}-element intake limit.`,
            }
          : {
              code: 'XML_ATTRIBUTE_LIMIT_EXCEEDED',
              description: `XML exceeds the ${MAX_XML_ATTRIBUTES.toLocaleString('en-US')}-attribute intake limit.`,
            },
      }
    }
    parseFailed = true
  }

  if (parseFailed) {
    return {
      ok: false,
      issue: { code: 'XML_NOT_WELL_FORMED', description: 'XML is not well formed.' },
    }
  }
  if (!root) {
    return {
      ok: false,
      issue: { code: 'XML_ROOT_INVALID', description: 'The XML root element could not be identified safely.' },
    }
  }
  return { ok: true, root, elementCount, attributeCount }
}

class XmlLimitError extends Error {
  constructor(readonly kind: 'elements' | 'attributes') {
    super(`XML ${kind} limit exceeded`)
  }
}
