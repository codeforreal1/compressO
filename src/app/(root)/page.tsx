'use client'

import React from 'react'
import { invoke } from '@tauri-apps/api'
import { open } from '@tauri-apps/api/dialog'
import { cacheDir } from '@tauri-apps/api/path'

import ThemeSwitcher from '@/components/ThemeSwitcher'
import Button from '@/components/Button'

export default function Home() {
  async function handleVideoSelection() {
    try {
      const path = await open({
        directory: false,
        multiple: false,
        title: 'Select video to compress',
        filters: [{ name: 'video', extensions: ['mp4', 'mov', 'mkv', 'avi'] }],
      })
      if (path == null || Array.isArray(path)) {
        console.warn('File selection config is invalid.')
        return
      }
      console.log(path)
      const result = await invoke('compress', { path })
      console.log('--Result', result)
    } catch (error) {
      console.log(error)
    }
  }
  return (
    <div>
      <div className="absolute bottom-4 left-4">
        <ThemeSwitcher />
      </div>
      <Button onClick={handleVideoSelection}>Click Me</Button>
    </div>
  )
}
