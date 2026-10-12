---
date: 2026-10-11
project: Agent Monitor / apps/web (Vue 3 + Vite 7)
status: fixed
---

# Vite build fail: key trên con trực tiếp của `<template v-for>`

## Triệu chứng
`vite build` (vitest vẫn pass) báo:
```
[vite:vue] <template v-for> key should be placed on the <template> tag.
F:/work/web/Claude-Code-Monitor/apps/web/src/components/PlanLimits.vue
<span :key="changes[w.key].n" class="ccm-tick ...">
```

## Nguyên nhân
Vue 3 compiler cấm `:key` trên phần tử là con trực tiếp của `<template v-for>` (key phải nằm trên chính `<template>`). Ở đây key dùng để re-mount span cho animation `ccm-tick` khi % đổi. Vitest không compile SFC template của component đó nên test không bắt được.

## Solution
Không đặt key lên con trực tiếp của `<template v-for>`: bọc thêm một phần tử không key rồi đặt key bên trong, hoặc bỏ `<template v-for>` và cho `v-for` lên một phần tử thật (về sau `PlanLimits.vue` dùng row `grid-cols-subgrid` có `v-for` + key, các con bên trong được phép có key).

## Context
`apps/web/src/components/PlanLimits.vue` (chip quota gọn v17). Vue 3 compiler-core, Vite 7.3.7.
