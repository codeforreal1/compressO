import React from 'react'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import Dialog from "./Dialog"

function Home() {
    return (
        <div>
            <div className="absolute bottom-4 left-4">
                <ThemeSwitcher/>
            </div>
            <Dialog/>
        </div>
    )
}


export default Home
