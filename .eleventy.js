module.exports = function (eleventyConfig) {
  // 画像・静的ツールはそのままコピー
  eleventyConfig.addPassthroughCopy({ "src/images": "images" });
  eleventyConfig.addPassthroughCopy({ "src/static": "." });

  // static配下のHTMLはテンプレート処理せずコピーのみ
  eleventyConfig.ignores.add("src/static/**");

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
