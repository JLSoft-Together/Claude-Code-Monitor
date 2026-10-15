import { describe, expect, it } from 'vitest'
import en from '../i18n/en'
import vi from '../i18n/vi'
import { cssColor, currentSwatch, drawableScale, isDrawableXml, MAX_FIT_SCALE } from './drawablePreview'
import { DENSITIES, compareConfigs, deviceFor, validDpi, withDensity, ZOOMS } from './layoutPreview'

const SHAPE = '<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android"><gradient android:startColor="#f00" android:endColor="#00f"/></shape>'

describe('drawable preview', () => {
  it('detects drawable folders and loose drawable roots, not layouts', () => {
    expect(isDrawableXml('/p/app/src/main/res/drawable/bg.xml', null)).toBe('drawable')
    expect(isDrawableXml('/p/res/color/text.xml', '<selector/>')).toBe('color')
    expect(isDrawableXml('F:\\repo\\bg_native_ad_cta.xml', SHAPE)).toBe('drawable')
    expect(isDrawableXml('/repo/a.xml', '<androidx.constraintlayout.widget.ConstraintLayout/>')).toBeNull()
    expect(isDrawableXml('/p/res/layout/a.xml', SHAPE)).toBeNull()
  })

  it('fits small icons up to ×8, fixed zoom is literal', () => {
    expect(drawableScale(24, 24, 1000, 1000, 'fit')).toBe(MAX_FIT_SCALE)
    expect(drawableScale(400, 200, 200, 200, 'fit')).toBe(0.5)
    expect(drawableScale(24, 24, 1000, 1000, 400)).toBe(4)
  })

  it('maps ARGB to CSS and the chips to a swatch', () => {
    expect(cssColor('#80FF0000')).toBe('rgb(255 0 0 / 0.502)')
    expect(currentSwatch([])).toBe('default')
    expect(currentSwatch(['selected', 'pressed'])).toBe('pressed')
    expect(currentSwatch(['pressed', 'disabled'])).toBe('disabled')
  })

  it('has en + vi strings for every state chip', () => {
    for (const lang of [en, vi] as unknown as { layout: { drawable: { states: Record<string, string>; swatch: Record<string, string> } } }[]) {
      for (const s of ['pressed', 'focused', 'selected', 'checked', 'activated', 'disabled']) {
        expect(lang.layout.drawable.states[s]).toBeTruthy()
        expect(lang.layout.drawable.swatch[s]).toBeTruthy()
      }
    }
  })
})

describe('density + zoom', () => {
  it('overrides the preset density only with a valid dpi', () => {
    const d = deviceFor('pixel5', false)
    expect(withDensity(d, 160)).toEqual({ ...d, density: 160 })
    expect(withDensity(d, 0)).toEqual(d)
    expect(withDensity(d, 5000)).toEqual(d)
    expect(validDpi(DENSITIES[0]!.dpi)).toBe(true)
    expect(compareConfigs('pixel5', false, 320).every((c) => c.device.density === 320)).toBe(true)
  })

  it('zooms above 100 %', () => {
    expect(Math.max(...ZOOMS)).toBe(400)
  })
})
