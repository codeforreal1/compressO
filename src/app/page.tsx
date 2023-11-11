"use client"

import React from "react";
import {invoke} from "@tauri-apps/api/tauri"

export default function Home() {
    const [name, setName] = React.useState<string>()

    async function greet() {
        try {
            const name = await invoke("greet", {name: "Niraj"}) as string
            setName(name)
        } catch (_) {
            console.log(_)
        }

    }

    return (
        <div>{name ?? ""}
            <button onClick={greet}>Click Me</button>
        </div>
    )
}
