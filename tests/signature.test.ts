import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyLineSignature } from '@/lib/line/signature'

const SECRET = 'test_channel_secret'
const sign = (body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(body, 'utf8').digest('base64')

describe('verifyLineSignature', () => {
  const body = JSON.stringify({ destination: 'U123', events: [{ type: 'message' }] })

  it('正しい署名を受け入れる', () => {
    expect(verifyLineSignature(body, sign(body), SECRET)).toBe(true)
  })

  it('別のシークレットで作った署名を拒否する', () => {
    expect(verifyLineSignature(body, sign(body, 'wrong_secret'), SECRET)).toBe(false)
  })

  it('ボディが1文字でも違えば拒否する', () => {
    expect(verifyLineSignature(`${body} `, sign(body), SECRET)).toBe(false)
  })

  it('署名が無ければ拒否する', () => {
    expect(verifyLineSignature(body, null, SECRET)).toBe(false)
    expect(verifyLineSignature(body, undefined, SECRET)).toBe(false)
    expect(verifyLineSignature(body, '', SECRET)).toBe(false)
  })

  it('長さの違う署名でも例外を投げずに拒否する', () => {
    // timingSafeEqual は長さが違うと例外を投げるので、その手前で弾けているか
    expect(() => verifyLineSignature(body, 'c2hvcnQ=', SECRET)).not.toThrow()
    expect(verifyLineSignature(body, 'c2hvcnQ=', SECRET)).toBe(false)
  })

  it('base64 として壊れた署名を拒否する', () => {
    expect(verifyLineSignature(body, '!!!not base64!!!', SECRET)).toBe(false)
  })

  it('シークレットが未設定なら拒否する', () => {
    expect(verifyLineSignature(body, sign(body), '')).toBe(false)
  })

  it('マルチバイトを含むボディでも一致する', () => {
    const jp = JSON.stringify({ text: '関西28卒バイトコミュニティ' })
    expect(verifyLineSignature(jp, sign(jp), SECRET)).toBe(true)
  })
})
