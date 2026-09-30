// The app lives inside the monorepo but has its own node_modules (React Native
// pins React exactly). It shares the database types in packages/db as source.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);
config.watchFolders = [path.resolve(projectRoot, '../../packages/db')];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.extraNodeModules = { '@nws-commerce/db': path.resolve(projectRoot, '../../packages/db/src') };
config.resolver.disableHierarchicalLookup = true;
module.exports = config;
