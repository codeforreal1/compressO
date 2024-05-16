import React from "react";
import { open } from "@tauri-apps/plugin-shell";

import Image from "@/components/Image";
import Icon from "@/components/Icon";

function About() {
  return (
    <section className="pt-8 px-4 pb-12">
      <section>
        <div className="z-10 flex justify-center items-center">
          <h2 className="text-3xl mr-2 font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            compressO
          </h2>
          <Image src="/logo.png" alt="logo" width={50} height={50} />
        </div>
        <p className="text-center italic text-gray-600 dark:text-gray-400 text-md my-1">
          Compress any video to a tiny size.
        </p>
      </section>
      <section className="my-8">
        <p className="text-center text-gray-600 dark:text-gray-400 text-sm my-1">
          Powered by{" "}
          <button
            className="text-lg font-bold text-primary"
            onClick={() => {
              open("https://ffmpeg.org/");
            }}
          >
            FFmpeg
          </button>
          <span className="block text-sm">
            This software uses libraries from the FFmpeg project under the
            LGPLv2.1.
          </span>
        </p>
      </section>
      <section>
        <p className="text-center text-gray-600 dark:text-gray-400 text-sm my-1">
          Made with <Icon className="inline text-primary" name="lowResHeart" />{" "}
          in public by{" "}
          <button
            className="font-bold text-primary"
            onClick={() => {
              open("https://www.threads.net/@codeforreal");
            }}
          >
            Code For Real
          </button>
        </p>
      </section>
      <section>
        <p className="text-sm text-center text-gray-600 dark:text-gray-400 my-2  flex items-center justify-center">
          <button
            className="ml-2  flex items-center justify-center gap-2"
            onClick={() => {
              open("https://github.com/codeforreal1/compressO");
            }}
          >
            Free and open-sourced{" "}
            <Icon
              name="github"
              size={25}
              className="text-gray-800 dark:text-gray-200"
            />
          </button>
        </p>
      </section>
    </section>
  );
}

export default About;
