import { existsSync, readFileSync } from 'node:fs'
import { tmpdir, cpus } from 'node:os'
import * as path from 'node:path'

import { pipe } from 'ramda'
import { z, ZodIssueCode } from 'zod'
import ms from 'ms'

import { domainConfigSchema, positiveIntSchema } from './domain/index.js'
import { preprocessUrls } from './domain/utils.js'

/**
 * Some frameworks will implicitly override NODE_ENV
 *
 * This causes some wackiness with different parts of the same process
 * thinking NODE_ENV is different values.
 *
 * So instead, we use a NODE_CONFIG_ENV environment variable
 * to distinguish which environment config to use. This seems to be a common convention
 * (see https://github.com/node-config/node-config/wiki/Environment-Variables#node_config_env)
 */
const MODE = process.env.NODE_CONFIG_ENV

if (!MODE) throw new Error('NODE_CONFIG_ENV must be defined')

const DEFAULT_PROCESS_WASM_MODULE_FORMATS = ['wasm32-unknown-emscripten', 'wasm32-unknown-emscripten2']

/**
 * The server config is an extension of the config required by the domain (business logic).
 * This prevents our domain from being aware of the environment it is running in ie.
 * An express server. Later, it could be anything
 */
const serverConfigSchema = domainConfigSchema.extend({
  MODE: z.enum(['development', 'production']),
  port: positiveIntSchema,
  ENABLE_METRICS_ENDPOINT: z.preprocess((val) => !!val, z.boolean()),
  DUMP_PATH: z.string().min(1)
})

/**
 * An Either would be nice here, but just throwing a literal
 * get's us what we need, for now.
 */
/* eslint-disable no-throw-literal */

/**
 * If the WALLET_FILE env var is defined, load the contents from the file.
 * Refuse to boot the app if both or none of WALLET and WALLET_FILE are defined.
 */
export const preprocessWallet = (envConfig) => {
  const { WALLET, WALLET_FILE, ...theRestOfTheConfig } = envConfig

  // nothing to do here
  if (!!WALLET && !WALLET_FILE) return envConfig

  if (!WALLET && !WALLET_FILE) throw 'One of WALLET or WALLET_FILE is required'
  if (!!WALLET && !!WALLET_FILE) throw 'Do not define both WALLET and WALLET_FILE'

  const walletPath = path.resolve(WALLET_FILE)
  if (!existsSync(walletPath)) throw `WALLET_FILE does not exist: ${walletPath}`

  try {
    const walletFromFile = readFileSync(walletPath, 'utf8')
    return {
      WALLET: walletFromFile,
      ...theRestOfTheConfig
    }
  } catch (e) {
    throw `An error occurred while reading WALLET_FILE from ${walletPath}\n${e}`
  }
}
/* eslint-enable no-throw-literal */

const preprocessedServerConfigSchema = z.preprocess(
  (envConfig, zodRefinementContext) => {
    try {
      return pipe(preprocessWallet, preprocessUrls)(envConfig)
    } catch (message) {
      zodRefinementContext.addIssue({ code: ZodIssueCode.custom, message })
    }
  },
  serverConfigSchema
)

/**
 * @type {z.infer<typeof serverConfigSchema>}
 *
 * We get some nice Intellisense by defining the type in JSDoc
 * before parsing with the serverConfig schema
 */
const CONFIG_ENVS = {
  development: {
    MODE,
    port: process.env.PORT || 6363,
    ENABLE_METRICS_ENDPOINT: process.env.ENABLE_METRICS_ENDPOINT,
    GATEWAY_URL: process.env.GATEWAY_URL || 'https://arweave.net',
    GRAPHQL_URL: process.env.GRAPHQL_URL,
    CHECKPOINT_GRAPHQL_URL: process.env.CHECKPOINT_GRAPHQL_URL,
    ARWEAVE_URL: process.env.ARWEAVE_URL,
    UPLOADER_URL: process.env.UPLOADER_URL || 'https://up.arweave.net',
    DB_URL: process.env.DB_URL || 'ao-cache',
    DUMP_PATH: process.env.DUMP_PATH || './static',
    WALLET: process.env.WALLET,
    WALLET_FILE: process.env.WALLET_FILE,
    MEM_MONITOR_INTERVAL: process.env.MEM_MONITOR_INTERVAL || ms('10s'),
    PROCESS_CHECKPOINT_CREATION_THROTTLE: process.env.PROCESS_CHECKPOINT_CREATION_THROTTLE || ms('30m'),
    DISABLE_PROCESS_CHECKPOINT_CREATION: process.env.DISABLE_PROCESS_CHECKPOINT_CREATION !== 'false',
    EAGER_CHECKPOINT_THRESHOLD: process.env.EAGER_CHECKPOINT_THRESHOLD || 100,
    /**
     *  EAGER_CHECKPOINT_ACCUMULATED_GAS_THRESHOLD: Amount of gas for 2 hours of continuous compute (300_000_000_000_000)
     *  This was calculated by creating a process built to do continuous compute. After 2 hours, this process used
     *  300 trillion gas. This is the baseline for checkpointing as no process should need to spend more than two hours
     *  catching up to a previous checkpoint.
     */
    EAGER_CHECKPOINT_ACCUMULATED_GAS_THRESHOLD: process.env.EAGER_CHECKPOINT_ACCUMULATED_GAS_THRESHOLD || 300_000_000_000_000,
    PROCESS_WASM_MEMORY_MAX_LIMIT: process.env.PROCESS_WASM_MEMORY_MAX_LIMIT || 1_000_000_000, // 1GB
    PROCESS_WASM_COMPUTE_MAX_LIMIT: process.env.PROCESS_WASM_COMPUTE_MAX_LIMIT || 9_000_000_000_000, // 9t
    PROCESS_WASM_SUPPORTED_FORMATS: process.env.PROCESS_WASM_SUPPORTED_FORMATS || DEFAULT_PROCESS_WASM_MODULE_FORMATS,
    PROCESS_WASM_SUPPORTED_EXTENSIONS: process.env.PROCESS_WASM_SUPPORTED_EXTENSIONS || [],
    WASM_EVALUATION_MAX_WORKERS: process.env.WASM_EVALUATION_MAX_WORKERS || Math.max(cpus().length - 1, 1),
    WASM_INSTANCE_CACHE_MAX_SIZE: process.env.WASM_INSTANCE_CACHE_MAX_SIZE || 5, // 5 loaded wasm modules
    WASM_MODULE_CACHE_MAX_SIZE: process.env.WASM_MODULE_CACHE_MAX_SIZE || 5, // 5 wasm binaries
    WASM_BINARY_FILE_DIRECTORY: process.env.WASM_BINARY_FILE_DIRECTORY || tmpdir(),
    PROCESS_IGNORE_ARWEAVE_CHECKPOINTS: process.env.PROCESS_IGNORE_ARWEAVE_CHECKPOINTS || [],
    IGNORE_ARWEAVE_CHECKPOINTS: process.env.IGNORE_ARWEAVE_CHECKPOINTS || [],
    PROCESS_CHECKPOINT_FILE_DIRECTORY: process.env.PROCESS_CHECKPOINT_FILE_DIRECTORY || tmpdir(),
    PROCESS_MEMORY_CACHE_MAX_SIZE: process.env.PROCESS_MEMORY_CACHE_MAX_SIZE || 500_000_000, // 500MB
    PROCESS_MEMORY_CACHE_TTL: process.env.PROCESS_MEMORY_CACHE_TTL || ms('24h'),
    PROCESS_MEMORY_CACHE_DRAIN_TO_FILE_THRESHOLD: process.env.PROCESS_MEMORY_CACHE_DRAIN_TO_FILE_THRESHOLD || ms('5m'),
    PROCESS_MEMORY_CACHE_FILE_DIR: process.env.PROCESS_MEMORY_CACHE_FILE_DIR || tmpdir(),
    PROCESS_MEMORY_CACHE_CHECKPOINT_INTERVAL: process.env.PROCESS_MEMORY_CACHE_CHECKPOINT_INTERVAL || 0,
    BUSY_THRESHOLD: process.env.BUSY_THRESHOLD || 0, // disabled
    RESTRICT_PROCESSES: process.env.RESTRICT_PROCESSES || [],
    ALLOW_PROCESSES: process.env.ALLOW_PROCESSES || [],
    ALLOW_OWNERS: process.env.ALLOW_OWNERS || []
  },
  production: {
    MODE,
    port: process.env.PORT || 6363,
    ENABLE_METRICS_ENDPOINT: process.env.ENABLE_METRICS_ENDPOINT,
    GATEWAY_URL: process.env.GATEWAY_URL || 'https://arweave.net',
    GRAPHQL_URL: process.env.GRAPHQL_URL,
    CHECKPOINT_GRAPHQL_URL: process.env.CHECKPOINT_GRAPHQL_URL,
    ARWEAVE_URL: process.env.ARWEAVE_URL,
    UPLOADER_URL: process.env.UPLOADER_URL || 'https://up.arweave.net',
    DB_URL: process.env.DB_URL || 'ao-cache',
    DUMP_PATH: process.env.DUMP_PATH || tmpdir(),
    WALLET: process.env.WALLET,
    WALLET_FILE: process.env.WALLET_FILE,
    MEM_MONITOR_INTERVAL: process.env.MEM_MONITOR_INTERVAL || ms('30s'),
    PROCESS_CHECKPOINT_CREATION_THROTTLE: process.env.PROCESS_CHECKPOINT_CREATION_THROTTLE || ms('30m'),
    DISABLE_PROCESS_CHECKPOINT_CREATION: process.env.DISABLE_PROCESS_CHECKPOINT_CREATION !== 'false', // TODO: disabled by default for now. Enable by default later
    EAGER_CHECKPOINT_THRESHOLD: process.env.EAGER_CHECKPOINT_THRESHOLD || 100,
    /**
     *  EAGER_CHECKPOINT_ACCUMULATED_GAS_THRESHOLD: Amount of gas for 2 hours of continuous compute (300_000_000_000_000)
     *  This was calculated by creating a process built to do continuous compute by adding and clearing a table.
     *  After 2 hours of nonstop compute, this process used 300 trillion gas.
     *  This is the baseline for checkpointing as no process should need to spend more than two hours catching up to a previous checkpoint.
     */
    EAGER_CHECKPOINT_ACCUMULATED_GAS_THRESHOLD: process.env.EAGER_CHECKPOINT_ACCUMULATED_GAS_THRESHOLD || 300_000_000_000_000,
    PROCESS_WASM_MEMORY_MAX_LIMIT: process.env.PROCESS_WASM_MEMORY_MAX_LIMIT || 1_000_000_000, // 1GB
    PROCESS_WASM_COMPUTE_MAX_LIMIT: process.env.PROCESS_WASM_COMPUTE_MAX_LIMIT || 9_000_000_000_000, // 9t
    PROCESS_WASM_SUPPORTED_FORMATS: process.env.PROCESS_WASM_SUPPORTED_FORMATS || DEFAULT_PROCESS_WASM_MODULE_FORMATS,
    PROCESS_WASM_SUPPORTED_EXTENSIONS: process.env.PROCESS_WASM_SUPPORTED_EXTENSIONS || [],
    WASM_EVALUATION_MAX_WORKERS: process.env.WASM_EVALUATION_MAX_WORKERS || Math.max(cpus().length - 1, 1),
    WASM_INSTANCE_CACHE_MAX_SIZE: process.env.WASM_INSTANCE_CACHE_MAX_SIZE || 5, // 5 loaded wasm modules
    WASM_MODULE_CACHE_MAX_SIZE: process.env.WASM_MODULE_CACHE_MAX_SIZE || 5, // 5 wasm binaries
    WASM_BINARY_FILE_DIRECTORY: process.env.WASM_BINARY_FILE_DIRECTORY || tmpdir(),
    PROCESS_IGNORE_ARWEAVE_CHECKPOINTS: process.env.PROCESS_IGNORE_ARWEAVE_CHECKPOINTS || [],
    IGNORE_ARWEAVE_CHECKPOINTS: process.env.IGNORE_ARWEAVE_CHECKPOINTS || [],
    PROCESS_CHECKPOINT_FILE_DIRECTORY: process.env.PROCESS_CHECKPOINT_FILE_DIRECTORY || tmpdir(),
    PROCESS_MEMORY_CACHE_MAX_SIZE: process.env.PROCESS_MEMORY_CACHE_MAX_SIZE || 500_000_000, // 500MB
    PROCESS_MEMORY_CACHE_TTL: process.env.PROCESS_MEMORY_CACHE_TTL || ms('24h'),
    PROCESS_MEMORY_CACHE_DRAIN_TO_FILE_THRESHOLD: process.env.PROCESS_MEMORY_CACHE_DRAIN_TO_FILE_THRESHOLD || ms('5m'),
    PROCESS_MEMORY_CACHE_FILE_DIR: process.env.PROCESS_MEMORY_CACHE_FILE_DIR || tmpdir(),
    PROCESS_MEMORY_CACHE_CHECKPOINT_INTERVAL: process.env.PROCESS_MEMORY_CACHE_CHECKPOINT_INTERVAL || 0,
    BUSY_THRESHOLD: process.env.BUSY_THRESHOLD || 0, // disabled
    RESTRICT_PROCESSES: process.env.RESTRICT_PROCESSES || [],
    ALLOW_PROCESSES: process.env.ALLOW_PROCESSES || [],
    ALLOW_OWNERS: process.env.ALLOW_OWNERS || []
  }
}

export const config = preprocessedServerConfigSchema.parse(CONFIG_ENVS[MODE])
