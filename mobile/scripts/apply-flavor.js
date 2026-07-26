/**
 * After `cap sync`, align Android applicationId / launcher name with the Capacitor flavor.
 * Run via npm scripts: sync / sync:adib
 */
const fs = require('fs')
const path = require('path')

const flavor = (process.env.FSERP_APP_FLAVOR || 'standard').trim().toLowerCase()
const isAdib = flavor === 'adib'

const appId = isAdib ? 'com.mahasoft.fserp.adib' : 'com.mahasoft.fserp'
const appName = isAdib ? 'Adib FS ERP' : 'FS ERP'

const root = __dirname ? path.join(__dirname, '..') : process.cwd()
const gradlePath = path.join(root, 'android', 'app', 'build.gradle')
const stringsPath = path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml')

if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8')
  gradle = gradle.replace(/applicationId\s+"[^"]+"/, `applicationId "${appId}"`)
  fs.writeFileSync(gradlePath, gradle)
  console.log(`Updated applicationId -> ${appId}`)
}

if (fs.existsSync(stringsPath)) {
  let strings = fs.readFileSync(stringsPath, 'utf8')
  strings = strings.replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${appName}</string>`)
  strings = strings.replace(
    /<string name="title_activity_main">[^<]*<\/string>/,
    `<string name="title_activity_main">${appName}</string>`
  )
  strings = strings.replace(/<string name="package_name">[^<]*<\/string>/, `<string name="package_name">${appId}</string>`)
  strings = strings.replace(
    /<string name="custom_url_scheme">[^<]*<\/string>/,
    `<string name="custom_url_scheme">${appId}</string>`
  )
  fs.writeFileSync(stringsPath, strings)
  console.log(`Updated launcher name -> ${appName}`)
}

console.log(`Flavor ready: ${isAdib ? 'adib (Aquaculture permanent)' : 'standard'}`)
