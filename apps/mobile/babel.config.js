module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // Lets db/migrations/migrations.js import the raw .sql migration files as
      // strings, so migrations ship inside the JS bundle rather than needing
      // filesystem access at runtime. Required by Drizzle's Expo setup.
      ['inline-import', { extensions: ['.sql'] }],
    ],
  };
};
