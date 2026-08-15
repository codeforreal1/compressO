import Icon from '@/components/Icon'
import Image from '@/components/Image'
import Title from '@/components/Title'
import { default as Link, default as TauriLink } from '@/tauri/components/Link'

function About() {
  return (
    <section className="px-4 py-10 w-full">
      <section className="mb-2">
        <Title title="关于" iconProps={{ name: 'info' }} />
      </section>
      <section>
        <div className="z-10 flex justify-center items-center flex-col">
          <Image
            disableAnimation
            src="/logo.png"
            alt="CompressO 标志"
            width={80}
            height={80}
          />
          <Link
            className="text-xs mx-auto block"
            href="https://compresso.codeforreal.com"
          >
            <h2 className="block text-3xl font-bold text-primary">CompressO</h2>
          </Link>
        </div>
        <p className="text-center italic text-gray-600 dark:text-gray-400 text-sm my-1">
          将图片或视频压缩到更小的体积。
        </p>
        <p className="self-end text-zinc-600 dark:text-zinc-400 ml-2 text-lg font-bold text-center">
          v{window.__appVersion ?? ''}
        </p>
      </section>
      <section className="mt-8">
        <p className="text-center text-gray-600 dark:text-gray-400 text-sm my-1">
          用 <Icon className="inline text-primary" name="lowResHeart" />{' '}
          开源制作，作者：{' '}
          <TauriLink href="https://codeforreal.com">Code For Real⚡</TauriLink>
        </p>
      </section>
      <section>
        <p className="text-sm text-center text-gray-600 dark:text-gray-400 flex-col flex items-center justify-center my-4">
          <Icon
            name="github"
            size={25}
            className="text-gray-800 dark:text-gray-200 mb-1"
          />
          <Link
            href="https://github.com/codeforreal1/compressO"
            className="flex items-center gap-1"
          >
            免费且开源{' '}
          </Link>
          <Link
            className="text-xs"
            href="https://github.com/codeforreal1/compressO/blob/main/LICENSE"
          >
            采用 AGPL-3.0 许可证
          </Link>
        </p>
      </section>
    </section>
  )
}

export default About
