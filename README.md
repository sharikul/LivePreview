# LivePreview
LivePreview is a front end playground for HTML and CSS. It aims to be really simple with simple features. Play around with it on <a href="http://livepreview.webege.com">livepreview.webege.com</a>. Help make LivePreview better by contributing to this repo. 

<center>
![LivePreview logo](https://raw.github.com/sharikul/LivePreview/master/imgs/icon.png)
</center>

## Update to CSS engine - 20/05/2013 (UK Timestamp)
LivePreview's CSS processor now allows you to reference values using variables, starting with the `$` symbol. Here's how you may go about using it:  

```scss
$lg = lightgray;
@import url(url-to-css-file-here-this-is-optional)

body {
    background: $lg; 
    /* This will change to background: lightgray;*/
}
```

As this feature is in its early stages, I can safely say that you will encounter some bugs along the way. **You must define variables at the very top of the CSS box else the engine won't be able to process the variables!** You can't use numbers in variable names either, and this stage (21/05/2013), you can't refer to other variables when setting the values of variables. 
