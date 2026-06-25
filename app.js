const htmlElement = document.documentElement
const themeToggle = document.getElementById('theme-toggler')

async function bl() {
    const main = document.getElementById('main-content')
    const post_links = document.createElement('div')
    post_links.id = 'post-links'
    post_links.className = 'main-sub-container'
    const post_links_sub = document.createElement('ul')
    post_links_sub.className = 'sub-list'

    const response = await fetch('https://theculdesac.club/api')
    const res = await response.json()

    main.innerHTML = ''

    const links_header = document.createElement('div')
    links_header.className = 'main-sub-header'
    const h = document.createElement('h2')
    h.innerHTML = "Recent Posts"
    links_header.appendChild(h)
    post_links.appendChild(links_header)

    res.posts.forEach((post, idx) => {

        if (idx === 0) {
            const blog_post = document.createElement('div')
            blog_post.className = 'main-sub-container'

            const header = document.createElement('div')
            header.className = 'main-sub-header'

            const title = document.createElement('h3')
            title.innerHTML = 'Latest Post'
            header.appendChild(title)

            const content = document.createElement('p')
            content.innerHTML = post.content

            blog_post.appendChild(header)
            blog_post.appendChild(content)

            main.appendChild(blog_post)




            // const links_header = document.createElement('div')
            // links_header.className = 'main-sub-header'
            // const h = document.createElement('h2')
            // h.innerHTML = "Recent Posts"
            // links_header.appendChild(h)
            // post_links.appendChild(links_header)

            // const link_title = document.createElement('li')
            // link_title.className = 'post-link'
            // link_title.innerHTML = `${new Date(post.date).toDateString()} – ${post.title}`

            // post_links.appendChild(link_title)
            main.appendChild(post_links)
        }
        const link_title = document.createElement('li')
        link_title.className = 'post-link'
        link_title.innerHTML = `${new Date(post.date).toDateString().slice(4)} – ${post.title}`

        post_links_sub.appendChild(link_title)
        post_links.appendChild(post_links_sub)
    })
}

function time_ago(date) {
    const seconds = Math.floor((Date.now() - new Date(date)) / 1000);

    if (seconds < 60) {
        return `${seconds} second${seconds !== 1 ? "s" : ""} ago`;
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
    }

    const days = Math.floor(hours / 24);
    if (days < 30) {
        return `${days} day${days !== 1 ? "s" : ""} ago`;
    }

    const months = Math.floor(days / 30);
    if (months < 12) {
        return `${months} month${months !== 1 ? "s" : ""} ago`;
    }

    const years = Math.floor(months / 12);
    return `${years} year${years !== 1 ? "s" : ""} ago`;
}

async function r() {
    const latest_status = document.getElementById('status')
    const status_date = document.getElementById('status-date')

    const response = await fetch('https://theculdesac.club/api/status?type=latest')
    const res = await response.json()

    const createdAt = new Date(res.status.createdAt)
    const now = new Date()

    const diff_ms = now - createdAt

    const seconds = Math.floor(diff_ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    latest_status.innerHTML = res.status.status
    status_date.innerHTML = time_ago(createdAt)
}

r()

if (window.location.pathname === "/blog.html") {
    bl()
}

const navList = document.getElementById('nav-list')
const navHeader = document.getElementById('nav-header')

function toggleNav() {
    if (navList.classList.contains('hidden')) {
        navList.classList.remove('hidden')
        navHeader.classList.add('bottom-border')
    } else {
        navList.classList.add('hidden')
        navHeader.classList.remove('bottom-border')
    }
}

document.getElementById('nav-toggle').addEventListener('click', () => {
    toggleNav()
})

document.addEventListener("DOMContentLoaded", () => {
    if (window.innerWidth <= 792) {
        navList.classList.add('hidden')
    }
    const theme = localStorage.getItem('theme')
    if (theme) {
        htmlElement.setAttribute("data-theme", theme)
        if (theme === 'dark') {
            themeToggle.toggleAttribute('checked')
        }
    }
})

window.addEventListener('resize', () => {
    if (window.innerWidth <= 792) {
        navList.classList.add('hidden')
    } else navList.classList.remove('hidden')
})

const ll = document.querySelectorAll('.navigation-link')

ll.forEach((l) => {
    l.addEventListener('click', () => {
        if (window.innerWidth <= 792) {
            navList.classList.add('hidden')
            navHeader.classList.remove('bottom-border')
        }
    })
})

// Function to switch themes
function toggleTheme() {
    const currentTheme = htmlElement.getAttribute("data-theme")
    const newTheme = currentTheme === "dark" ? "light" : "dark"
    
    htmlElement.setAttribute("data-theme", newTheme)
    localStorage.setItem("theme", newTheme)
}

themeToggle.addEventListener('click', () => {
    toggleTheme()
})