const html = document.documentElement

const elements = {
    main: document.getElementById("main-content"),
    status: document.getElementById("status"),
    status_date: document.getElementById("status-date"),
    nav_list: document.getElementById("nav-list"),
    nav_header: document.getElementById("nav-header"),
    nav_toggle: document.getElementById("nav-toggle"),
    theme_toggle: document.getElementById("theme-toggler"),
}

const BLOG_API = "https://theculdesac.club/api"
const STATUS_API = "https://theculdesac.club/api/status?type=latest"



////////////
// Utilities
////////////

function time_ago(date) {
    const seconds = Math.floor((Date.now() - new Date(date)) / 1000)

    const intervals = [
        ["year", 31536000],
        ["month", 2592000],
        ["day", 86400],
        ["hour", 3600],
        ["minute", 60],
        ["second", 1],
    ]

    for (const [label, size] of intervals) {
        const value = Math.floor(seconds / size)

        if (value >= 1) {
            return `${value} ${label}${value !== 1 ? "s" : ""} ago`
        }
    }

    return "Just now"
}

function create_element(tag, className, text) {
    const element = document.createElement(tag)

    if (className) {
        element.className = className
    }

    if (text !== undefined) {
        element.textContent = text
    }

    return element
}



///////
// Blog
///////

let all_posts

function latest_post(post) {
    const container = create_element("div", "main-sub-container")

    const header = create_element("div", "main-sub-header")
    header.appendChild(create_element("h3", null, "Latest Post"))

    const content = create_element("p")
    content.innerHTML = `<b style="text-decoration: underline;">${post.title}</b><br><br>${post.content}`

    container.append(header, content)

    return container
}

function recent_posts(posts) {
    const container = create_element("div", "main-sub-container")
    container.id = "post-links"

    const header = create_element("div", "main-sub-header")
    header.appendChild(create_element("h2", null, "Recent Posts"))

    const list = create_element("ul", "sub-list")

    posts.forEach(post => {
        const item = create_element(
            "li",
            "post-link",
            `${new Date(post.date).toDateString().slice(4)} – ${post.title}`
        )
        item.addEventListener('click', () => {
            swap_post(post)
        })
        list.appendChild(item)
    })

    container.append(header, list)

    return container
}

function swap_post(post) {
    elements.main.innerHTML = ""

    elements.main.append(
        latest_post(post),
        recent_posts(all_posts)
    )
}

async function load_all_posts() {
    try {
        const response = await fetch(BLOG_API)
        const { posts } = await response.json()

        if (!posts.length) {
            return
        }

        all_posts = posts

        elements.main.innerHTML = ""

        elements.main.append(
            latest_post(posts[0]),
            recent_posts(all_posts)
        )

    } catch (err) {
        console.error("Failed to load blog posts:", err)
    }
}




/////////
// Status
/////////

async function latest_status() {
    try {
        const response = await fetch(STATUS_API)
        const { status } = await response.json()

        elements.status.textContent = status.status
        elements.status_date.textContent = time_ago(status.createdAt)
    } catch (err) {
        console.error("Failed to load status:", err)
    }
}




/////////////
// Navigation
/////////////

function toggle_nav() {
    const hidden = elements.nav_list.classList.toggle("hidden")

    elements.nav_header.classList.toggle("bottom-border", !hidden)
}

function update_nav_visibility() {
    if (window.innerWidth <= 792) {
        elements.nav_list.classList.add("hidden")
        elements.nav_header.classList.remove("bottom-border")
    } else {
        elements.nav_list.classList.remove("hidden")
    }
}




////////
// Theme
////////

function apply_theme(theme) {
    html.setAttribute("data-theme", theme)
    localStorage.setItem("theme", theme)

    elements.theme_toggle.toggleAttribute("checked", theme === "dark")
}

function toggle_theme() {
    const current = html.getAttribute("data-theme") || "light"

    apply_theme(current === "dark" ? "light" : "dark")
}




/////////////////
// Initialization
/////////////////

document.addEventListener("DOMContentLoaded", () => {
    update_nav_visibility()

    const saved_theme = localStorage.getItem("theme")
    if (saved_theme) {
        apply_theme(saved_theme)
    }

    latest_status()

    if (window.location.pathname === "/blog.html") {
        load_all_posts()
    }
})

window.addEventListener("resize", update_nav_visibility)

elements.nav_toggle.addEventListener("click", toggle_nav)

elements.theme_toggle.addEventListener("click", toggle_theme)

document.querySelectorAll(".navigation-link").forEach(link => {
    link.addEventListener("click", () => {
        if (window.innerWidth <= 792) {
            elements.nav_list.classList.add("hidden")
            elements.nav_header.classList.remove("bottom-border")
        }
    })
})