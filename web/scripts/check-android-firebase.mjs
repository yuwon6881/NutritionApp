import { readFileSync } from 'node:fs'

const expectedProjectId = 'project-7eb1aec8-8636-4c86-b2a'
const configPath = new URL('../android/app/google-services.json', import.meta.url)
const gradlePath = new URL('../android/app/build.gradle', import.meta.url)

let config
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'))
} catch (error) {
  throw new Error('Android push builds require a valid android/app/google-services.json.', { cause: error })
}

const gradle = readFileSync(gradlePath, 'utf8')
const packageName = gradle.match(/applicationId\s+["']([^"']+)["']/)?.[1]
if (!packageName) throw new Error('Could not read applicationId from android/app/build.gradle.')
if (config.project_info?.project_id !== expectedProjectId) {
  throw new Error(`Android Firebase config must use ${expectedProjectId}.`)
}

const hasMatchingAndroidClient = config.client?.some(
  client => client.client_info?.android_client_info?.package_name === packageName,
)
if (!hasMatchingAndroidClient) {
  throw new Error(`Android Firebase config has no client for ${packageName}.`)
}

console.log(`Android Firebase config matches ${packageName} in ${expectedProjectId}.`)
