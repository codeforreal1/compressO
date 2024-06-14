import React from 'react'
import { open } from '@tauri-apps/plugin-shell'

import Image from '@/components/Image'
import Icon from '@/components/Icon'
import TauriLink from '@/tauri/components/Link'
import Title from '@/components/Title'

function About() {
  return (
    <section className="px-4 py-10 w-full">
      <section className="mb-6">
        <Title title="About" iconProps={{ name: 'info' }} />
      </section>
      <section>
        <div className="z-10 flex justify-center items-center">
          <h2 className="text-3xl mr-2 font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            compressO
          </h2>
          <Image src="/logo.png" alt="logo" width={50} height={50} />
        </div>
        <p className="text-center italic text-gray-600 dark:text-gray-400 text-sm my-1">
          Compress any video to a tiny size.
        </p>
      </section>
      <section className="my-8">
        <p className="text-center text-gray-600 dark:text-gray-400 text-sm my-1">
          Powered by{' '}
          <TauriLink href="https://ffmpeg.org/" className="text-lg">
            FFmpeg
          </TauriLink>
          <span className="block text-sm max-w-[450px] mx-auto">
            This software uses libraries from the FFmpeg project under the
            LGPLv2.1.
          </span>
        </p>
      </section>
      <section>
        <p className="text-center text-gray-600 dark:text-gray-400 text-sm my-1">
          Made with <Icon className="inline text-primary" name="lowResHeart" />{' '}
          in public by{' '}
          <TauriLink href="https://www.threads.net/@codeforreal">
            Code For Real⚡
          </TauriLink>
        </p>
      </section>
      <section>
        <p className="text-sm text-center text-gray-600 dark:text-gray-400 my-2  flex items-center justify-center">
          <button
            type="button"
            className="ml-2  flex items-center justify-center gap-2"
            onClick={() => {
              open('https://github.com/codeforreal1/compressO')
            }}
          >
            Free and open-sourced{' '}
            <Icon
              name="github"
              size={25}
              className="text-gray-800 dark:text-gray-200"
            />
          </button>
        </p>
      </section>
      <p className="self-end text-gray-400 ml-2 text-lg font-bold text-center">
        v{process.env.version}
      </p>
    </section>
  )
}

export default About
