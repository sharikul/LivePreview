# LivePreview
LivePreview is a front end playground for HTML and CSS. It's a great tool if you've suddenly got an idea you'd like to quickly jot down without having to get a development environment set up. Play around with it on <a href="http://livepreview.webege.com">livepreview.webege.com</a>. Help make LivePreview better by contributing to this repo. 

<center>
![LivePreview logo](https://raw.github.com/sharikul/LivePreview/master/imgs/icon.png)
</center>

### HTML Box
LivePreview's _HTML Box_ is where you write all of the HTML code (<em>obviously</em>) that will be rendered in the _pallet_ on the right. Though you can, you aren't required to add things like `<!DOCTYPE>` or `<html>` tags because those are pre-rendered for you. The text editor can also help with indentation, too, with great syntax highlighting.

### CSS Box
Almost likewise to the _HTML Box_, LivePreview's _CSS Box_ is where you write all of the necessary CSS code that will style the elements in the _pallet_. You're able to use `@import` statements too if you need to do so to include external CSS stylesheets in your work.  

To help you out a bit, I (<em>Sharikul Islam</em>) have added a _variables_ feature built into LivePreview's CSS Engine. If you're someone who uses a preprocessing language such as _Sass_ (<em>which is a great tool!</em>), you'll be familiar with the concept of variables and how it can help you out. Similarly to _Sass_, you can declare variables beginning with the `$` symbol. However, unlike _Sass_, to set a value to a variable, instead of a colon, you required to use an equals (`=`) symbol instead. 

Here's how you may use variables in your CSS work:  

```scss
$lg = lightgray;
$ws = whitesmoke;
$main_font = 'Open Sans', sans-serif;
$second_font = serif;

body {
    background-color: $ws; // this will render into background-color: whitesmoke;
    font-family: $main_font; // this will render into font-family: 'Open Sans', sans-serif;
}

h1, h2, h3, h4, h5, h6 {
    font-family: $second_font; // this will render into font-family: serif;
}
```

The variables will be processed in **real time** and the values will be added to the properties which you've assigned variables to, provided that you have defined them first!  

**Please declare your variables AT THE VERY TOP of the _CSS Box_, before any `@import` statements, otherwise the engine will fail to process them.**

